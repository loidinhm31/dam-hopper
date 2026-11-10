# Stream/input review — phases 05–06

## Scope and coverage
- Baseline `3f20a8a9` → `cdfa9c6b`; source read-only. Reviewed assigned producer, fanout, protocol, diagnostics, input, API viewport/control routes, UI stream/input/text/canvas/parser and Browser API types/client; traced production consumers in `BrowserStreamKeepAliveHost.tsx`, CDP actor, attachments and session registry.
- Authority: selected `plans/261108-0237-host-browser-cdp-streaming/{plan,architecture-contracts,phase-05-producer-fanout,phase-06-viewer-client}.md`; README, PDR, code standards and code-review skill read.
- Phase 05 coverage: start/stop, ACK/run handling, candidate publication, geometry/cache, credits/writer, memory. Phase 06: fresh attachments, decode/dispositions, privacy, input mapping/sequencing, text/IME. Static scope complete; runtime/platform qualification incomplete.
- No tests/build/lint/formatters run by this reviewer. Runtime observations below explicitly belong to coordinator Main's production probes, not this reviewer. Plans/product not edited.

## Findings — ranked P0–P3
No P0 identified. Findings below remain despite administrative DONE labels.

### SI-01 — P1: Display and input use different geometry; raw changes do not fence input
- **Locations:** `server/src/browser_host/screencast.rs:694–714`, `server/src/browser_host/media.rs:908–923,965–966`; supporting `screencast.rs:110–142,228–254`, `session.rs:699–723`, `input.rs:428–438`.
- **Trace:** producer retains requested initial geometry; initial Page attachment never applies that viewport. Publication substitutes native event geometry without updating producer geometry or viewport epoch. Dispatch instead reads `producer.geometry()`. Raw gateway fence mutates only SessionRegistry, and often cannot match its flattened session ID to native target ID; neither producer nor input manager is fenced.
- **Observed by Main:** requested 800×600 produced trusted native 780×493. After API resize to 900×700/epoch2, agent changed native viewport to 1000×800: trusted frames still epoch2; old epoch2 input accepted; displayed center click reached DOM `[450,350]`, not `[500,400]`.
- **Impact/confidence:** wrong element activation and stale-coordinate input after same-target agent interference; high, production-reproduced.
- **Minimal fix:** one authoritative geometry/epoch transaction shared by registry, producer/cache and input manager; apply initial native viewport; synchronously disable input/invalidate old frames before external geometry changes; reconcile native metrics before trusting publication.
- **Blind spot:** `server/tests/browser_host_input.rs:273–357` changes registry without native producer; producer test asserts dimensions bounded, not identical to dispatch coordinates.

### SI-02 — P1: Lease release/cancel clears bookkeeping without releasing Chromium state
- **Locations:** `server/src/api/browser_host.rs:907–909`; `server/src/browser_host/input.rs:384–407,423–424,460–480,496–498`; `server/src/browser_host/media.rs:1047`.
- **Trace:** REST release discards `release_lease()`'s returned events. Sequence-gap/overflow paths likewise discard `revoke_lease()` releases; expired leases return an error without release or timer cleanup. PointerCancel clears held buttons, then its CDP dispatcher does nothing, so subsequent disconnect has no button left to release.
- **Observed by Main:** real page received Shift keydown; REST release returned 200/released; page still had no keyup after 150ms. Manual agent keyup required cleanup.
- **Impact/confidence:** stuck modifiers/buttons survive control loss and affect subsequent viewer input; high, native release case reproduced; cancel/expiry source-confirmed.
- **Minimal fix:** route every revocation/cancel through ordered native release dispatch before clearing held state/finalizing lease, retain key+code/button state, expire leases actively, propagate failed dispatch as unavailable rather than success.
- **Blind spot:** `server/tests/browser_host_input.rs:243–269` checks HTTP/next acquisition only; UI release tests assert outgoing PointerCancel, not DOM mouseup.

### SI-03 — P1: Client cleanup can send sequence gaps and releases on the replacement lease
- **Locations:** `packages/ui/src/browser-host/input-controller.ts:371–400,405–432,447–467`.
- **Trace:** a queued move reserves seq2; `releaseAllHeldInput()` sends keyup seq3 before flushing seq2 at its end. Server rejects seq3 and revokes. `syncLeaseState()` installs/reset-sequences the new token before calling release, so old held state is released using ambient new target/socket/lease. Saturation simply drops the pending record/release and clears local held state without closing the channel.
- **Impact/confidence:** blur/modal/lease switch can strand native keys/buttons or inject release into a replacement target; high static confidence. Server SI-02 makes the gap case persist remotely.
- **Minimal fix:** capture original socket/target/token/sequence with held and queued state; flush ordered barriers before release; finish old-channel release before rebinding; saturation must revoke/close reliably rather than silently clear local state.
- **Blind spot:** `input-controller.test.ts:196–223` explicitly expects the release to use the new sequence/lease; `:415–452` has no pending move or saturated socket.

### SI-04 — P1: Concurrent screencast start and viewport change deadlock
- **Locations:** `server/src/browser_host/screencast.rs:193–223,340–402`.
- **Trace:** update_geometry holds `geometry.write()` through CDP await211 and then requests `state.read()`212. Concurrent first/resume start holds `state.write()`340 and waits for `geometry.read()`380. With the already-attached production Page session, resize holds geometry → start acquires state → resize's CDP completes → both wait forever.
- **Impact/confidence:** viewport HTTP request and producer startup hang; stream stops progressing. High static confidence; this is a specific concurrent lock inversion, not a claim ordinary resize always freezes.
- **Minimal fix:** release geometry lock before awaits/other locks; serialize producer transitions with one ordered operation owner and consistent lock ordering.
- **Blind spot:** producer tests resize only after streaming is established, never race start/resume against update.

### SI-05 — P1: Control-only viewers bypass capacity/pairing and are not timer-reaped
- **Locations:** `server/src/browser_host/media.rs:423–444,783–811,825–834,896–923`; supporting `attachments.rs:374–425,555–598`.
- **Trace:** only media acquires the two-viewer permit. Control registers immediately, advertises inputAvailable and dispatches valid lease input without testing whether matching media exists. Half-pair expiry runs only inside another register_connection call; auth supervisor does not sweep it. Consume tickets repeatedly to retain arbitrarily many authenticated control sockets; a final unpaired socket survives its 15s mate deadline indefinitely.
- **Impact/confidence:** input before paired admission, unbounded active control tasks/auth checks, and qualified viewer cap bypass; high static confidence. Amplifies serial auth-supervisor latency (separate admission review).
- **Minimal fix:** reserve capacity per pair, gate input on fully admitted pair and lease viewer identity, and timer-reap incomplete pairs independently of new traffic; clean up failed upgrades.
- **Blind spot:** `server/tests/browser_host_media.rs:224–295` registers both halves before using manager directly; live WS test `:424–458` checks handshake/status only.

### SI-06 — P1: Native event loss/actor failure leaves a permanently stalled producer
- **Locations:** `server/src/browser_host/screencast.rs:483–509,561–581,228–233,425–448`; supporting `cdp.rs:283–309,426–436,757–766`.
- **Trace:** producer awaits ACK response and screenshot/CDP operations while ingress is a two-slot lossy broadcast. Lagged events are ignored without their native ACK obligations or aborting the run. Actor death does not close the receiver because CdpClient itself retains a broadcast sender; producer never watches actor health. ACK failure marks Stopped/cancels, but ordinary heartbeat only refreshes an existing demand and never restarts it. Retry also reuses the cached Page session/client.
- **Impact/confidence:** lost native credit can suppress final frames; transient actor/ACK failure leaves visible viewers frozen indefinitely. High static confidence; runtime fault injection not performed here.
- **Minimal fix:** bounded explicit ACK admission independent of response wait; treat lost ingress/actor closure as fatal run failure, close/detach old Page session, reconnect actor and establish fresh run while demand remains. Do not replay ambiguous ACKs.
- **Blind spot:** `browser_host_screencast.rs:209–254` observes blank-page traffic for one second, without blocked ACK responses, lag or actor teardown.

### SI-07 — P2: Global 128MiB accounting excludes live payloads and decode/pack overlap
- **Locations:** `server/src/browser_host/screencast.rs:587–602,650–661,717–724,795–839`; supporting `cdp.rs:602–603,757–766`, `command_budget.rs:14–19,94–100`.
- **Trace:** event strings/broadcast entries and copied encoded candidate exist without a global reservation. Publication reserves roughly base64 length once, then simultaneously retains encoded candidate + decoded JPEG + newly packed complete BHJF; only after allocation adjusts to the packed size. Commands have a separate per-client budget, not the shared global counter. Thus global reserved-byte admission can succeed while actual retained Browser payloads exceed its ceiling.
- **Impact/confidence:** advertised hard ceiling/high-water diagnostics are not a bound on the covered payloads; high static confidence. No claim of a measured 128MiB breach.
- **Minimal fix:** reserve each distinct ingress/candidate/transient allocation before creation, share ingress ownership rather than clone strings, account decode/pack overlap, and connect command budgets to global reservation. Preserve complete-buffer charge through physical writer ownership.
- **Blind spot:** `browser_host_bounds.rs:113–152` checks TrackedBhjfFrame clones only, not producer/actor/transient allocation paths or production `clone_data()` ownership.

### SI-08 — P2: Counter wire contract is numeric and loses u64 identity
- **Locations:** `packages/ui/src/api/browser-host-types.ts:126–132,179–185,349–356`; `browser-host/input-controller.ts:349–359,421–431`; `server/src/api/browser_host.rs:719–724`; `server/src/browser_host/input.rs:107–115`.
- **Trace:** DTO viewportEpoch is a string; setBrowserViewport serializes caller value unchanged, while Rust expects JSON u64. Main verified `viewportEpoch:'1'` receives 422. Input controller converts string epoch through Number and uses numeric inputSeq/profileEpoch; above 2^53 distinct valid counters alias, and incremented sequences cease being contiguous.
- **Impact/confidence:** normal typed string-DTO reuse fails viewport API now; large counter values cannot round-trip. High; 422 production-reproduced, precision loss statically certain.
- **Minimal fix:** canonical decimal-string counters end-to-end, checked BigInt/u64 parsing at boundaries, no number unions/Number conversion; migrate all callers and server request DTOs together.
- **Blind spot:** current tests use epochs1/2 and numeric request bodies; frame parser's BigInt tests do not cover REST/input consumers.

### SI-09 — P2: Fresh attach retains old target pixels/input rectangle and unfenced control callbacks
- **Locations:** `packages/ui/src/browser-host/stream-controller.ts:135–155,200–209,360–368,488–495`.
- **Trace:** attach invalidates pending/decode and swaps credentials but does not black/close lastCachedBitmap or clear lastDrawnRect/lastFrameHeader. Attaching a different target/owner leaves previous pixels visible until a new frame; resize can redraw them. Old control.onmessage has no captured-socket/subscription/owner check and can still deliver queued status into the replacement consumer.
- **Impact/confidence:** stale page disclosure and old input geometry under new owner/session; high static confidence. Root OS ownership findings reported separately.
- **Minimal fix:** synchronously retire old presentation/cache/input geometry before target/owner change; fence every callback against captured immutable credentials/socket and current owner generation.
- **Blind spot:** stream tests cover privacy blackening, not target/owner reattach while cached static pixels remain.

### SI-10 — P2: New viewport does not invalidate an active old-epoch decode
- **Locations:** `packages/ui/src/browser-host/stream-controller.ts:269–302,312–314,349–359`.
- **Trace:** epoch1 frame decoding; epoch2 frame arrives and becomes pending, but receive does not advance any geometry/decode fence. Resolving epoch1 still passes isStillValid because it checks socket/subscription/token only, not current profileEpoch/viewportEpoch/producer run. Old image is drawn/ACKed after newer geometry has arrived; header geometry callback already ran for epoch2.
- **Impact/confidence:** obsolete pixels can repaint across resize/geometry fence and restore old hit-test metadata; high static confidence.
- **Minimal fix:** track authoritative current geometry/run fence independently of decode invocation; discard old completions and validate profile/epoch before accepting and immediately before drawing.
- **Blind spot:** `stream-controller.test.ts:138–238` tests three frame sequences in the same epoch/run only; privacy case invalidates a separate token.

### SI-11 — P2: Text proxy does not implement exactly-once IME commit
- **Locations:** `packages/ui/src/browser-host/text-input-proxy.tsx:53–78,83–98`.
- **Trace:** compositionend sends final text but never records it in lastCommittedRef. A following committed beforeinput/textInput or input with that same text sends it again. Conversely input-only fallback suppresses two genuine identical edits within100ms because the heuristic compares text/time rather than the originating edit.
- **Impact/confidence:** duplicated composed text or dropped repeated characters on real IME/input event sequences; high static confidence for these sequences, physical Android not exercised by this reviewer.
- **Minimal fix:** commit once per edit/composition transaction with explicit event/inputType state; consume trailing composition commit, not arbitrary same-text events within a time window.
- **Blind spot:** `browser-tests/host-browser-input.browser.tsx:241–270,291–305` dispatches compositionend alone, not its trailing native text/input events; Android harness has the same abbreviated sequence.

### SI-12 — P2: Closed/stale session tickets still admit apparently healthy sockets
- **Locations:** `server/src/api/browser_host.rs:1262–1275`; `server/src/browser_host/media.rs:408–452,769–797,827–834`; supporting `session.rs:434–437`, `attachments.rs:543–553`.
- **Trace:** ticket issue tests session existence, not running status/current incarnation/profile epoch; upgrade rechecks auth only. DELETE cancels existing attachments, not outstanding target tickets. A pre-delete ticket, or new ticket for retained Closed DTO, still registers; media ensure attaches to stale native target or returns no producer, while control advertises inputAvailable:true and media reserves a viewer slot.
- **Impact/confidence:** stale connections consume scarce capacity and appear input-ready after explicit target closure, instead of failing closed; high static confidence. Normal native target DELETE itself works, as Main verified; no blanket missing-close claim.
- **Minimal fix:** revalidate exact live target/process/profile identity atomically at issue and consume/registration; invalidate unconsumed target tickets on close; fail upgrade if producer/native attach cannot be established.
- **Blind spot:** media journey creates tickets with direct managers, never closes target between issue/upgrade or submits stale identity.

## Positive observations / non-findings
- BHJF target-only contiguous publication, parser size/SOF validation, exact receiving-socket subscription credit comparison, reservation-before-delivery and 2-outstanding/1-pending controller are present.
- Client binds frame dispositions to originating socket/subscription; privacy synchronously blackens and invalidates active decode; pending replacement sends explicit discard.
- Did not report unconditional resize freezing: Main's actual engine continued producing after numeric viewport resize. Chromium149 restart-counter research is not proof the deployed binary has identical repeated-start behavior.

## Qualification blockers and minimal improvement order
1. Fix SI-01–06 first; coordinator should qualify actual production stream + DOM input/release oracles, concurrent start/resize, blocked ACK/actor death and lone control sockets beyond mate timeout.
2. Fix memory and wire contract; qualify whole live allocation path and string counters through production REST/WS, not parser/RAII helpers alone.
3. Fix viewer owner/epoch/IME transactions; run real mounted/native text event sequences, stale socket callbacks and delayed-decode geometry transitions.
- Existing reports' DONE/check counts do not establish native Windows, physical Android web IME/keyboard, supported-version restart semantics, final/static frame or full memory/performance qualification. Those remain separate blockers, not additional generic code findings.

## Unresolved questions
- None requiring a product decision. Actor failure/lag and concurrent lock inversion need coordinator-owned targeted runtime qualification; this reviewer performed source analysis only for those scenarios.
