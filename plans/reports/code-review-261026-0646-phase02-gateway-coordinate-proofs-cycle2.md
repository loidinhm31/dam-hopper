# Code Review — Phase 02 Gateway Coordinate Proofs, Cycle 2

## Overall assessment

**Score: 6/10 — changes required.** Reviewed current files, not the remediation description. F8 remains sound in the bounded-document paths; immutable unopened-pin proof consumption and the active-child cleanup repair are useful. Causal WebSocket probes improve reader ordering. However, several Cycle 1 issues remain in actual code: default production features retain global barriers, terminal enqueue is not cancellation/deadline fenced, several actor awaits remain unbounded, independent incarnation counters are still compared, and baseline evidence is not replayable. Selected green tests do not close these gaps.

Static review; no implementation or plan/task-state changes. Only this review report created. Executable results below are explicitly attributed to the independent Cycle 2 tester.

## Critical issues

None identified. No demonstrated new authentication bypass, outside-target disclosure, or A-coordinate/B-proof relabeling in the repaired unopened-pin path. The high-priority warnings below still block acceptance.

## Warnings

### W1 — High: default builds still include process-global race controls
- **Evidence:** `server/Cargo.toml:35–43`; `server/src/semantic/gateway.rs:51–67,1864–1868,1992–1996,2192–2196`; `.github/workflows/release-linux.yml:77,117`; `Dockerfile:23,29`; `package.json:23`.
- `cfg(any(test, feature = "test-support"))` does not exclude hooks when `default = ["test-support"]`. Existing shipping commands do not pass `--no-default-features`; the release/no-default-features check validates an alternate configuration, not the normal release pipeline.
- Flags and Notify instances remain shared across all gateways. Tests enable flags before setup and reset only on success. Concurrent unrelated navigation can enter another test's pause; a panic can leave flags enabled. Pause waits have neither deadline nor cancellation selection.
- **Impact:** violates the phase's no-production-race-scaffolding requirement and leaves default-concurrent tests susceptible to cross-test interference/hangs. No remote API enabling these flags was identified.
- **Correction:** make test-support explicitly opt-in, enable it in the integration-test invocation, and use request/connection-scoped, bounded, RAII-reset synchronization. Ensure actual shipping builds exclude hooks.
- **Confidence:** high; direct configuration and control-flow evidence. Concurrent failure not dynamically reproduced here.

### W3 — High: pre-publication recheck still precedes an unfenced await
- **Evidence:** `server/src/semantic/gateway.rs:1585–1604,2343–2379`; `server/src/semantic/outbound.rs:66–78`; `server/src/api/semantic_ws.rs:413–473`.
- Success checks deadline/cancellation, releases the logical-map lock, then `finish` awaits message/byte reservations for up to two seconds. During that wait `$/cancelRequest` can mark the still-owned entry cancelled. When capacity returns, `send` commits the already-built success frame without another check. The writer fences session authority, not individual navigation cancellation/deadline.
- **Impact:** cancellation received before terminal enqueue can still produce success; success can also enqueue after the overall navigation deadline. Moving map cleanup after send protects ID ownership, but does not close the publication race.
- **Correction:** reserve outbound capacity under the original deadline and a wakeable cancellation signal; recheck/transition logical terminal state immediately before a non-awaiting frame commit. Add saturated-outbound cancellation and deadline regressions.
- **Confidence:** high; concrete static interleaving, not dynamically reproduced by this reviewer.

### W4 — Medium: overall deadline/cancellation still does not span all stages
- **Evidence:** `server/src/semantic/gateway.rs:1543,1614–1615,1712,1820–1862,1924–1933,2138–2142,2168–2172`; `server/src/semantic/session.rs:275–314,367–377,438–448`.
- Only the first open-destination snapshot and stage-two submission gained `timeout_at`. Source snapshot acquisition, post-requery source/destination snapshots, and cancellation enqueue remain directly awaited. Those session APIs do not enforce the navigation deadline; cancellation enqueue can itself wait for actor command capacity.
- Disk metadata/read/projection runs synchronously on the async completion task before the first gap cancellation check. Logical cancellation is a boolean, so it cannot interrupt an ongoing snapshot or pin await.
- **Impact:** congestion/slow filesystem work can retain a logical permit beyond its promised deadline and delay cancellation. Timeout cleanup can block while trying to enqueue child cancellation.
- **Correction:** consistently bound every navigation-owned await with the same absolute deadline and request cancellation signal; start the deadline before stage-one admission. Move blocking pin acquisition off the runtime worker, keep it bounded, and check cancellation before pin work/admission. Preserve actor-operation ownership when a waiting caller times out.
- **Confidence:** high on missing bounds; operational delay magnitude unmeasured.

### W5 — High: acceptance scenarios remain materially incomplete
- **Evidence:** `server/tests/semantic_websocket.rs:2005–2018,2083–2159,2273–2329,2386–2396,2449–2481,2538–2548,2601–2633`; phase requirements `phase-02-gateway-coordinate-proofs.md:30–36,51–57,104–106,131–138`.
- Probes now establish that the sequential reader handled the preceding didOpen/cancel notification. This removes the prior 50 ms ordering guess, but does not establish the missing acceptance observations.
- F3 still queries a disk pin A, then first user-opens B after map capture. It never exercises absent-at-submission → user-open A before pin → requery A → edit B. The earlier positive control opens the destination before navigation submission and therefore bypasses this branch.
- The stage-two fixture answers immediately and has no child-cancel recorder. Pausing the gateway after submission is not holding a live child reply. The probe acknowledges reader processing/command enqueue, not actor application or child cancellation. The gap test asserts only `-32800`, not absence of stage-two dispatch.
- Duplicate-ID coverage remains a timer-based stage-one case. No eight-slot recovery/map-empty regression, expired-gap cleanup test, held-stage duplicate-ID checks, source mutation, close/reopen, rejected-open divergence, or malformed/missing-proof regression is present in the added cases.
- **Impact:** green tests do not establish the stated F3/F9 contracts and miss W1/W3/W4/W6.
- **Correction:** use acknowledged, request-scoped barriers at the actual actor/child boundaries; record child request/cancel IDs and counts, enforce the specified user-open-A scenario, and assert both-map cleanup plus all eight reusable slots across terminal paths. Include freshness/proof negative controls with stable positive controls.
- **Confidence:** high; direct fixture and assertion inspection.

### W6 — Medium: independent actor/gateway incarnation counters are still compared
- **Evidence:** `server/src/semantic/gateway.rs:1023–1040,1741,1770–1773,2163–2176,2227–2232`; `server/src/semantic/overlay.rs:329–355`.
- The new `open_dest_actor_identities` map is populated but never read. Requery verification still compares `s.open_incarnation == submit_inc` and proven `snap_inc == submit_inc`, where `submit_inc` is gateway-owned.
- Gateway increments its counter before actor acceptance; actor rejects duplicate/count/byte-limit opens before incrementing its counter. A rejected open followed by a valid reopen separates the counters.
- **Impact:** stable mixed open/unopened requery can reject `STALE_VERSION` after a rejected open, despite unchanged actor and gateway identities within their respective owners. This is a false rejection, not evidence of proof relabeling.
- **Correction:** compare gateway identities with captured gateway identities and actor identities with captured actor/proven identities. Actually consume the captured actor map, or remove it if a simpler existing provenance identity supplies the same fence. Add rejected-open → reopen → mixed-destination positive regression, including the user-open-before-pin case.
- **Confidence:** high; direct equality comparisons and counter-allocation sequence.

### W7 — Medium: the purported replayable baseline patch cannot establish the logged tests
- **Evidence:** `plans/reports/baseline-b031e6a-f3-f9-failing-before.md:11–43,54–107,133–141,184–191`.
- The inline patch adds gateway barriers and a supervisor accessor only. It never adds either `test_baseline_b031e6a_*` test invoked by the command. Its first hunk also declares six old/eighteen new lines while displaying only two context lines plus thirteen added lines; the displayed patch is incomplete as a unified diff.
- A pristine checkout therefore cannot reproduce the logged two tests with the supplied overlay. Exit 0 records a harness asserting baseline defects, not proof that these instructions reconstruct that harness.
- Baseline identity/merge-base verification output and overlay digest are still absent. F9 records only the gap, not a held stage-two reply or an explicit API incompatibility. F3 still lacks user-open A before pin.
- **Impact:** required failing-before/identical-passing-after evidence remains incomplete. Historical stdout is retained, but not independently replayable.
- **Correction:** retain a complete, syntactically valid overlay including fixture/test definitions; exact checkout/merge-base identity and patch digest; commands/raw results for both F9 barriers and the specified F3 scenario. Record any genuine baseline API exception explicitly.
- **Confidence:** high on artifact incompleteness. Historical commands were not rerun in this review.

### W8 — Medium: terminal enqueue failure silently retires the request on a live connection
- **Evidence:** `server/src/semantic/gateway.rs:1593–1603,2571–2581`; `docs/code-standards.md:126`.
- `finish` discards the timeout/send result and removes logical ownership/capacity regardless. In contrast, `send_outbound` tears down on enqueue failure. A full queue can outlast a producer's timeout even while a slow but progressing writer keeps the socket alive.
- **Impact:** a client can receive no terminal frame and no disconnect, while the server already permits reuse of that ID. This violates the terminal publication/channel-failure contract and makes completion ambiguous.
- **Correction:** route completion-send failure through the existing connection/session failure path rather than silently dropping it; release ownership exactly once while terminating failed transport. Test a stalled producer with a still-live receiver.
- **Confidence:** high on ignored failure and missing teardown; live-socket interleaving is static, not reproduced here.

## Suggestions

1. **KISS/DRY:** `finish(msg)` deriving the active child from owned state fixes the previous caller-supplied-ID cleanup hazard (Cycle 1 W2). Continue that narrow design: one terminal transition should own commit/failure/cleanup, rather than dozens of `guard.completed = true` branches disabling fallback before an await. No generic request framework needed.
2. **Strengthen remaining real-tuple oracles:** `semantic_tsls_e2e.rs:1507–1512,1565–1569` still searches serialized JSON for `"line":3`. The projected-pin path at `1615–1630` is improved: exact URI, starting coordinate, SHA and zero pin identity. Also assert exact range end, proof text, post-edit raw overlay bytes, and unchanged disk bytes; apply structural assertions to the direct-overlay cases too. This test exercises the actor, not WebSocket publication or actual-web reveal.
3. **Docs follow-through:** gateway architecture `docs/architecture/semantic-websocket-gateway.md:194–198` still documents cancelled IDs becoming null, despite repaired original-ID correlation. Reconcile protocol/architecture/changelog with actual accepted behavior through the coordinator's documented ownership; do not mark unfinished F3/F9 acceptance complete.

## Positive observations

- Shared borrowed scanner in `overlay.rs:43–178` preserves CR/LF/CRLF byte offsets and trailing empty lines without per-line allocation. UTF-16 edit surrogate policy is retained.
- Requery parsing verifies text SHA before provenance acceptance and strips internal snapshots before response filtering (`gateway.rs:2052–2078`). Outbound location/link construction remains whitelisted and virtual-URI contained.
- `finish` now derives/removes the active-child reverse entry rather than depending on caller-supplied optional IDs; the previous expired-stage-two map-leak path is statically repaired (`gateway.rs:1585–1603,1888–1920`). Direct cleanup/capacity regression remains absent.
- Logical request IDs survive first-child completion and stay owned through outbound enqueue; reader-acknowledging probes are a real improvement over arbitrary sleeps.
- Both default/all-target and no-default-feature release configurations have independent compile-check evidence, without claiming the latter matches existing release pipelines.

## Reviewed files

Primary changed files/sections:
- `server/src/semantic/overlay.rs`
- `server/src/semantic/uri.rs`
- `server/src/semantic/gateway.rs`
- `server/Cargo.toml`
- `server/tests/semantic_websocket.rs`
- `server/tests/semantic_tsls_e2e.rs`
- `plans/reports/baseline-b031e6a-f3-f9-failing-before.md`

Supporting evidence: `server/src/semantic/session.rs`, `outbound.rs`, `resources.rs`, `server/src/api/semantic_ws.rs`, README, PDR, code standards, gateway architecture, remediation overview/Phase 02, Cycle 1 review, Cycle 2 tester report, shipping Cargo commands in Dockerfile/package.json/release workflow. Approximately 2,200 changed implementation/test lines plus surrounding contracts inspected. Plans intentionally unchanged: coordinator owns task state; assignment prohibits TODO tracking.

## Validation commands/results

Reviewer executed read-only `git diff --stat`, `git status --short`, and scoped `git diff`; inspected source/fixtures/contracts directly. No reviewer build/test/lint/format run and no source edits.

**Independent tester evidence:** `plans/reports/tester-261026-0638-phase02-gateway-coordinate-proofs-cycle2.md:23–30,34–120,124–129`.

| Command | Reported result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --lib semantic::overlay` | Exit 0; 9 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --lib semantic::uri` | Exit 0; 17 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test semantic_websocket -- --test-threads=1` | Exit 0; 16 passed, 0 failed; 228.49 s execution |
| `cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e test_packaged_tsls_lossless_cr_line_definition_and_ranged_edits` | Exit 0; 1 passed, 0 failed, 4 filtered out; 16.41 s execution |
| `cargo check --manifest-path server/Cargo.toml --all-targets` | Exit 0; tester records no diagnostics |
| `cargo check --manifest-path server/Cargo.toml --release --no-default-features` | Exit 0; tester records no diagnostics; alternate feature configuration only |

**Total reported:** 43 selected tests passed, no failures or ignored tests. No clippy/lint or quantitative code/test coverage result. Default-concurrent WebSocket, full pinned-engine suite, baseline replay, saturated terminal output, and actual-web reveal were not exercised by this reviewer; tester explicitly did not run concurrent WebSocket/full TSLS/browser qualification. After remediation, coordinator should run the focused missing regressions, default-harness WebSocket suite, full real-tuple suite and applicable compile gates once, then retain Phase 04 actual-web qualification separately.

## Unresolved questions

No user design decision required. Remaining evidence gaps: complete replayable baseline overlay and both F9 barriers; concurrent harness isolation; terminal backpressure cancellation/deadline/failure; rejected-open identity divergence and full mapping/capacity recovery. Existing reports do not resolve these questions.
