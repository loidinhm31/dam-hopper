# Code Review — Phase 02 Gateway Coordinate Proofs, Cycle 1

## Overall assessment

**Score: 6/10 — changes required.** F8's borrowed line scanner is sound in the reviewed bounded-document paths. F3 now retains verified immutable requery text instead of substituting live destination text. F9 logical-ID ownership is substantially improved. However, timeout cleanup leaks a reverse-map entry, publication can still race cancellation/deadline, and the new tests do not establish the required deterministic interleavings. Production includes process-global race-test controls expressly forbidden by the phase contract.

Review is static; executable results below are attributed to the independent tester, not rerun or independently claimed. No implementation or plan/task-state changes made.

## Critical issues

None identified. No new demonstrated authentication bypass, outside-target disclosure, or coordinate/proof relabeling in the repaired unopened-pin path. High-priority warnings below block acceptance.

## Warnings

### W1 — High: runtime ships process-global test barriers
- **Evidence:** `server/src/semantic/gateway.rs:51–66,1842–1845,1956–1959,2155–2158`; `server/Cargo.toml:35–37`; `server/tests/semantic_websocket.rs:2163–2165,2330–2332,2476–2478`.
- Public `test_barriers` and all three pause branches are unconditional production code. Flags affect every gateway in the process; enabled barriers await a notification without cancellation/deadline selection. Tests set flags before lengthy setup and reset only on success.
- **Impact:** violates Phase 02's no-production-race-scaffolding contract. Under the normal concurrent Rust test harness, unrelated unopened-navigation tests can enter another test's barrier; a panic can leave all subsequent matching requests parked. Default-false flags are not evidence of a remote exploit, but do not make this acceptable runtime architecture.
- **Correction:** move synchronization to existing fixture boundaries or explicit test-only compilation/injection excluded from release builds; scope controls to one connection/request, use bounded waits and RAII reset. Plain `cfg(test)` alone will not expose hooks to integration tests compiling the library normally.
- **Confidence:** high, direct control-flow evidence.

### W2 — High: timeout before stage-two submission leaks reverse mapping
- **Evidence:** `server/src/semantic/gateway.rs:1865–1887,1888–1897,1584–1600`.
- Stage two inserts `requery_id` into `internal_map` and sets it active. The immediately following deadline-expired branch calls `finish(err, None)`. `finish` removes a reverse entry only when its optional argument is present; `guard.completed = true` disables fallback cleanup.
- **Impact:** every request taking this timeout path retains a reverse-map entry until connection teardown, despite logical-ID/capacity release. Repeated timeouts violate bounded ownership and the exactly-once mappings-cleanup acceptance criterion.
- **Correction:** check expiry before registering stage two, and make terminal cleanup derive/remove the registered active child rather than relying on caller-supplied `None`/`Some`. Add an expired-gap regression asserting both maps empty and all eight slots reusable.
- **Confidence:** high, direct control-flow evidence.

### W3 — High: cancellation/deadline recheck precedes an awaiting publication operation
- **Evidence:** `server/src/semantic/gateway.rs:2305–2341,1584–1600`; `server/src/semantic/outbound.rs:66–78`; writer fencing in `server/src/api/semantic_ws.rs:408–473`.
- Success checks deadline and cancellation, releases the logical-map lock, then `finish` awaits outbound message and byte reservations for up to `SOCKET_SEND_TIMEOUT`. Meanwhile `$/cancelRequest` can mark the still-owned logical entry cancelled. Once capacity returns, the prebuilt success frame is enqueued without another check. The writer has session-revocation fencing, not per-request cancellation/deadline fencing.
- **Impact:** a request cancelled while terminal publication is blocked can still publish success; publication can also occur after the overall navigation deadline. Holding ID ownership through enqueue fixes early reuse, but does not close this race.
- **Correction:** select cancellation/deadline while reserving output capacity, then recheck/transition terminal state immediately before committing the reserved frame. Keep ID/capacity ownership until that commit or failed-send cleanup. Add a saturated-outbound regression cancelling an awaiting producer.
- **Confidence:** high, statically demonstrated interleaving; not dynamically reproduced in this review.

### W4 — Medium: overall deadline does not bound inter-stage actor awaits
- **Evidence:** `server/src/semantic/gateway.rs:1542,1709,1745–1747,1798–1840,1901–1908,2101–2105,2131–2133`; `server/src/semantic/session.rs:301–314,367–377,390–405`.
- The shared deadline is selected against child replies, but snapshot requests and pinned-command admission are awaited directly. These session APIs fence revocation, not the navigation deadline or logical cancellation. Disk metadata/read work is also synchronous in the completion task. Boolean cancellation state cannot wake an in-progress gap await.
- **Impact:** actor congestion/recovery or slow filesystem work can retain a logical permit beyond the promised overall deadline; cancellation in the gap is only observed after the await/work completes.
- **Correction:** apply the same deadline and request cancellation signal across inter-stage awaits; move potentially blocking disk reads off the async worker and retain ownership through completion/cleanup. Check cancellation/expiry before beginning pin work, not only after it.
- **Confidence:** high on missing bounds; operational latency magnitude unmeasured.

### W5 — High: race regressions are not deterministic and omit decisive acceptance observations
- **Evidence:** `server/tests/semantic_websocket.rs:2279–2326,2446–2472,2529–2539,2592–2618,2005–2016,2083–2159`.
- F3 uses a 50 ms sleep to assume `didOpen(B)` was applied. It never user-opens A before pin admission: A is the disk pin and B is the first user-open document, unlike the required absent → user-open A → requery A → edit B scenario.
- F9 gap/stage-two tests resume immediately after WebSocket `send`; socket-write completion does not acknowledge cancellation processing. Their fixture answers stage two immediately rather than holding the second child reply, and does not record child cancellation IDs. A final `-32800` therefore does not prove gap cancellation prevented stage-two launch or active stage-two work received cancellation.
- Duplicate-ID coverage relies on a 100 ms child timer during stage one; it does not hold the pin gap or stage two. One post-cancel request is not an eight-slot capacity/map cleanup test. New coverage also lacks the planned source mutation, destination close/reopen, malformed/missing proof, and mixed open/unopened requery controls.
- **Impact:** tests can pass without the intended ordering and miss W2–W4. The independent tester ran only serialized tests; process-global interference under the default harness is unqualified.
- **Correction:** use request-scoped, acknowledged barriers for actor-applied edits/cancellation, held child replies, and terminal enqueue. Assert exact child request/cancel IDs, no stage-two dispatch after gap cancellation, one terminal result, duplicate rejection in both stages, both-map cleanup and eight-slot recovery. Add the specified user-open-A and freshness/proof negative controls.
- **Confidence:** high, direct test-oracle evidence.

### W6 — Medium: new freshness checks compare independent incarnation counters
- **Evidence:** `server/src/semantic/gateway.rs:1022–1039,2136–2139,2190–2203`; `server/src/semantic/overlay.rs:329–355`.
- New requery checks compare actor `open_incarnation` directly with the gateway's `submit_inc`. Gateway increments its counter before `did_open`; the actor rejects duplicate/open-count/session-budget failures before incrementing its own counter. These counters can diverge after a rejected open.
- **Impact:** after a duplicate `didOpen` rejection and a valid reopen, otherwise stable mixed open/unopened navigation can incorrectly return `STALE_VERSION` for the rest of the connection. The existing single-destination tests do not enter this mixed requery case.
- **Correction:** compare gateway identities against captured gateway identities, and actor incarnations against captured actor incarnations/proven snapshots; do not assume numeric equality between distinct owners. Add rejected-open → reopen → stable mixed-destination requery coverage.
- **Confidence:** high, statically derived sequence; not dynamically reproduced here.

### W7 — Medium: baseline evidence is not independently replayable and does not cover both F9 barriers
- **Evidence:** `plans/reports/baseline-b031e6a-f3-f9-failing-before.md:11–42,68–76,119–126`; Phase 02 requirements at `phase-02-gateway-coordinate-proofs.md:30–36,51–57`.
- Report retains command/output and concrete A-coordinate/B-digest evidence, which is useful. But a pristine baseline checkout does not contain the named baseline tests or added barriers. The exact overlay patch and application command are absent, and the worktree is documented as removed. No checkout/merge-base verification output is retained. F9 logs only the gap scenario, not a held stage-two child reply or documented API exception. F3 describes opening B after map capture, not the required user-open-A-before-pin sequence.
- **Impact:** documented commands alone cannot reproduce the experiment, and the required identical failing-before/passing-after scenarios are not established.
- **Correction:** retain a complete test/barrier overlay patch with digest and application commands, actual baseline identity output, raw logs and explicit oracles for both F9 stages. Use the same acknowledged scenario on baseline and repair, with only the expected assertion polarity changed where necessary. Record any genuine baseline API incompatibility explicitly.
- **Confidence:** high on report completeness; historical execution is reported, not independently re-executed.

## Suggestions

1. **KISS/DRY:** replace repeated `guard.completed = true` plus manually chosen `finish(..., child_id)` branches with one narrow terminal cleanup path deriving ownership from the logical entry. No general request framework needed. W2 is a concrete cost of the current repetition.
2. **Stronger real-tuple oracles:** `server/tests/semantic_tsls_e2e.rs:1507–1512,1565–1569,1614–1623` searches serialized JSON for `"line":3` and a metadata field name. Parse the result and assert exact destination URI, definition range, proven text/SHA/version/incarnation, post-edit raw CR overlay bytes, and unchanged disk bytes. This remains an actor-level test, not gateway/WebSocket or actual-web reveal qualification.

## Positive observations

- Shared borrowed CR/LF/CRLF iterator preserves original byte offsets and trailing empty lines without per-line allocations (`overlay.rs:43–178`). Existing surrogate-split edit policy retained.
- Unit regressions cover mixed separators, trailing separators, exact ranged-edit bytes, UTF-16 astral boundaries and invalid positions.
- Requery proof digest is recomputed before acceptance, and internal proven text is removed before normal response sanitization (`gateway.rs:2015–2041`).
- Originally open destinations receive another freshness check across requery; outbound result construction continues to whitelist fields and translate contained virtual URIs.
- Logical IDs now survive first-child completion and cancellation retains the original client ID.

## Reviewed files and evidence

Primary files reviewed in full changed sections:
- `server/src/semantic/overlay.rs`
- `server/src/semantic/uri.rs`
- `server/src/semantic/gateway.rs`
- `server/tests/semantic_websocket.rs`
- `server/tests/semantic_tsls_e2e.rs`
- `plans/reports/baseline-b031e6a-f3-f9-failing-before.md`

Supporting sections inspected: `server/src/semantic/session.rs`, `server/src/semantic/outbound.rs`, `server/src/api/semantic_ws.rs`, `server/Cargo.toml`, README, PDR, code standards, gateway architecture, remediation overview/Phase 02, and independent tester report. Approximately 2,100 added/changed implementation/test lines plus surrounding contracts inspected. Plans intentionally unchanged: coordinator owns task state; this assignment prohibits TODO tracking.

## Validation commands/results

Reviewer executed read-only `git diff --stat`, `git status --short`, and scoped `git diff` commands for production and pinned-engine changes; no build/test/lint rerun or modifications to implementation.

Independent execution evidence: `plans/reports/tester-261026-0227-phase02-gateway-coordinate-proofs.md:38–118`; tester also confirmed no default-parallel WebSocket or full TSLS run.

| Command | Independent tester result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --lib semantic::overlay` | Exit 0; 9 passed |
| `cargo test --manifest-path server/Cargo.toml --lib semantic::uri` | Exit 0; 17 passed |
| `cargo test --manifest-path server/Cargo.toml --test semantic_websocket -- --test-threads=1` | Exit 0; 16 passed; 225.70 s |
| `cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e test_packaged_tsls_lossless_cr_line_definition_and_ranged_edits` | Exit 0; 1 passed; 4 filtered out |
| `cargo check --manifest-path server/Cargo.toml --all-targets` | Exit 0; report records no diagnostics |

**Total reported:** 43 selected tests passed. No quantitative code/test coverage or clippy result available. Green selected tests do not close the missing acceptance cases above. After remediation, coordinator should run the targeted regressions, default-harness WebSocket suite, full pinned-engine suite, and all-target check once; actual-web reveal remains the integrated qualification gate.

## Unresolved questions

- Exact baseline overlay patch/raw-log provenance is not retained in the reviewed report; original historical experiment cannot be independently reconstructed from it.
- Default-concurrent WebSocket behavior and full pinned-engine/browser qualification remain unobserved in this cycle. These are evidence gaps, not user design questions.
