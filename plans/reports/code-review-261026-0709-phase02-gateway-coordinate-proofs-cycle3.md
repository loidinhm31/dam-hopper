# Code Review — Phase 02 Gateway Coordinate Proofs, Cycle 3

## Overall assessment

**Score: 6/10 — changes required; acceptance remains open.** Improvements are real: test-support no longer ships by default; immutable requery proof is retained; actor and gateway destination incarnations are compared within their respective domains; enqueue failure now revokes the session. However, several Cycle 2 warnings remain, and the claimed replayable baseline artifact is demonstrably malformed.

Static review of the five assigned files plus relevant consumers/contracts. No source or plan/task-state edits, no duplicate build/test runs. Only this report created. Coordinator retains tracking ownership.

## Critical issues

None established. No demonstrated new authentication bypass or outside-target disclosure. This does not waive the high-priority acceptance blockers below.

## Warnings

### W1 — High: feature cutover silently removes gateway coverage from CI; barriers remain process-global

- **Evidence:** `server/Cargo.toml:35–42`; `.github/workflows/pr-quality-gate.yml:203–206`; `package.json:27–29,47`; `server/src/semantic/gateway.rs:51–79,1944–1948,2087–2091,2304–2308`.
- Removing the default feature fixes production inclusion. But the entire `semantic_websocket` target now requires `test-support`, while existing PR CI and normal test commands do not enable it. All 17 gateway tests, including existing auth/lifecycle tests, are silently skipped there.
- The three enabled flags/Notify pairs still affect every gateway in the process. BarrierGuard resets all flags, not just its own test, and does not wake already-paused workers. Concurrent tests can consume each other's pauses/resumes or clear each other's flags; the sole passing run was explicitly serialized.
- **Correction:** wire the feature-enabled target into CI and documented runners; use per-request/connection hooks or enforce serialization for every affected test, with bounded waits and teardown that wakes paused workers. Do not restore default production inclusion.
- **Confidence:** high on configuration/control flow; concurrent failure not executed.

### W3 — High: cancellation/deadline recheck still precedes blocking outbound admission

- **Evidence:** `gateway.rs:1599–1646,2454–2490`; `outbound.rs:66–78`; `api/semantic_ws.rs:413–488`.
- `finish` now checks cancellation, but builds `final_msg` before awaiting channel/byte capacity. While that await is pending, a cancel can mark the still-owned logical entry; capacity recovery nevertheless commits the previously built success. The separate send timeout can also extend beyond the navigation deadline. Writer fencing covers session authority, not logical-request cancellation/deadline.
- **Correction:** reserve capacity under the original deadline and a wakeable logical cancellation signal; recheck/transition to terminal state immediately before non-awaiting commit. Add saturated-output cancellation/deadline tests.
- **Confidence:** high; concrete static interleaving, not a runtime reproduction.

### W4 — Medium: one absolute deadline and cancellation do not cover every navigation-owned await

- **Evidence:** `gateway.rs:1473–1475,1556,1657–1658,2006–2007,2118–2119,2233–2237`; `session.rs:275–314,367–377,438–448`.
- Deadline starts after first-stage submission. Post-requery source snapshot remains directly awaited. Cleanup's child-cancel enqueue can wait indefinitely for actor command capacity; session APIs provide revocation fencing but no navigation deadline. A boolean cancellation flag cannot interrupt an ongoing disk/snapshot wait.
- **Correction:** start the deadline before submission; consistently apply it and logical cancellation to owned awaits, including bounded cleanup scheduling that preserves child-operation ownership.
- **Confidence:** high on missing bounds; operational delay unmeasured.

### W5 — High: added tests still do not prove the named F3/F9 acceptance cases

- **Evidence:** `semantic_websocket.rs:1927–1959,2163–2330,2334–2483,2487–2636,2680–2683,2746–2778`; Phase 02 `:30–36,51–57,104–106,131–138`.
- F3 still queries a disk pin A, then first user-opens B after capture. It does not cover absent-at-submission → user-open A before pin → query A → edit B. Its earlier user-open positive control opens before navigation submission and bypasses this branch.
- Stage two replies immediately; gateway pause after submission does not hold an active child reply. No child-cancel IDs/counts are recorded. Gap test checks only the terminal error, not absence of stage-two dispatch. Duplicate-ID coverage remains stage-one/timer based.
- New saturation test is useful but relies on a 60 ms fixture delay, verifies only successful completion recovery, and tests one subsequent admission rather than all eight recovered slots or empty maps. Timeout/revocation/channel-failure cleanup and close/reopen/source-mutation/malformed-proof cases remain unproven.
- **Correction:** acknowledged request-scoped actor/child barriers; child request/cancel logs; exact planned F3 interleaving; held-stage duplicate-ID checks; deterministic full-capacity recovery and negative proof/freshness controls.
- **Confidence:** high; direct fixture/assertion evidence.

### W7 — Medium: baseline patch is corrupt and uses incompatible APIs

- **Evidence:** `baseline-b031e6a-f3-f9-failing-before.md:59–109,129–139,198–203`; baseline `semantic_websocket.rs` fixture declarations; `semantic/supervisor.rs:208`; `tests/common/semantic_fixtures.rs` declarations.
- Test definitions were added, but unified-diff counts/context remain wrong. Independently extracting the fenced patch and passing it to `git apply --numstat -` exits **128: `error: corrupt patch at <stdin>:19`**. First hunk declares old/new 6/18 lines; actual 2/15. All five hunks have mismatched counts.
- Even fixing counts would not reproduce the logged tests: patch calls nonexistent `common::semantic_fixtures::make_test_app`, awaits synchronous `SemanticSupervisor::new`, and calls one-argument `start_server` with two arguments. Baseline/current supervisor and common fixture files have no diff, confirming these are not API migrations hidden by this branch.
- F9 overlay also resumes immediately after socket cancel send, without reader acknowledgement; it lacks held-stage-two reproduction. F3 still lacks required user-open A before pin. Historical output is not established by these instructions.
- **Correction:** retain the actual successfully applied/tested diff with compatible fixture setup, baseline/merge-base identity and patch digest; replay in a pristine disposable worktree and record both F9 boundaries and specified F3 scenario.
- **Confidence:** high; patch parser failure directly exercised, API mismatches statically inspected. Historical runtime commands not rerun.

### W8 — Medium: session revocation on enqueue failure is not guaranteed transport termination

- **Evidence:** `gateway.rs:1628–1646`; `api/semantic_ws.rs:402–408,414–442,461–472,673–709`.
- Enqueue failure now revokes the shared session token, improving admission safety. It does not notify the transport cancellation channel or close outbound admission. Writer observes the token while actively sending/checking frames, not while idle in recv; reader selects its separate cancellation channel. A slow-but-progressing writer can drain rewritten queued frames and then leave the socket live without the failed request's terminal frame.
- **Correction:** use the connection's failure/termination path on terminal enqueue failure, not token revocation alone. Test a stalled producer with a still-live, progressing receiver; require disconnect or terminal outcome and exact cleanup.
- **Confidence:** high on missing direct teardown; timing interleaving not dynamically reproduced.

### W9 — High: off-thread read is neither byte-bounded nor lifetime-bounded

- **Evidence:** `gateway.rs:1879–1908`; existing safer reader `fs/secure_path.rs:598–665`; bounded verifier ownership pattern `semantic/supervisor.rs:149–174`.
- Metadata size/type is checked before opening. `read_to_string` then reads the path without a byte cap or descriptor-bound no-follow/freshness validation. Growth/replacement between stat and read can exceed MAX_DOCUMENT_BYTES or follow a replacement symlink/FIFO.
- `timeout_at(spawn_blocking(...))` drops the JoinHandle, not the running blocking operation. Request slots are later released while detached reads continue; repeated timeouts can accumulate filesystem workers outside the eight-logical-request bound. This is not an established remote exploit; workspaces remain trusted, but finite-work contracts are still violated.
- **Correction:** reuse the bounded regular-file snapshot reader under off-thread admission, retain its worker permit until blocking completion, enforce max+1 read bound and descriptor/root identity checks. Keep metadata/open/read work off executor threads.
- **Confidence:** high on semantics; filesystem race/resource exhaustion not dynamically reproduced.

## Suggestions / positive observations

1. **KISS/DRY:** keep one narrow terminal transition owning publication/failure/cleanup. Repeating `guard.completed = true` before each awaited finish disables fallback early and complicates review; no generic request framework needed.
2. **Real tuple assertions:** direct-overlay checks still search serialized JSON for `"line":3` (`semantic_tsls_e2e.rs:1507–1512,1565–1569`), unchanged from Cycle 2. Mirror projected-path structural URI/range assertions; assert exact range end, proof text, post-edit raw overlay and unchanged disk bytes. Projected path's exact URI/start/SHA/zero identity assertions are good.
3. **Documentation:** update accepted protocol/architecture/changelog behavior, test feature invocation and original-ID cancellation correlation through the coordinator. Do not mark incomplete acceptance complete.
4. **Credit:** immutable proof parsing validates text SHA and removes internal metadata; logical ownership survives both child stages; actor/gateway destination identity comparisons are separated (`gateway.rs:1828–1832,2261–2287,2341–2342`). Prior W6 is statically addressed. Production default exclusion is addressed; W1 as a whole is not. Prior active-child cleanup improvement remains intact.

## Reviewed files

Primary: `server/Cargo.toml`; `server/src/semantic/gateway.rs`; `server/tests/semantic_websocket.rs`; `server/tests/semantic_tsls_e2e.rs`; `plans/reports/baseline-b031e6a-f3-f9-failing-before.md`.

Supporting: `server/src/semantic/{session,outbound,supervisor}.rs`; `server/src/api/semantic_ws.rs`; `server/src/fs/secure_path.rs`; `server/tests/common/semantic_fixtures.rs`; `.github/workflows/pr-quality-gate.yml`; package.json; README/PDR/code standards; remediation Phase 02 and Cycle 2 review. Approximately 2,100 changed code/test lines plus 333-line baseline report and surrounding contracts inspected. Plans intentionally unchanged.

## Validation commands/results

**Reviewer:** scoped `git diff --stat` / `git diff`; inspected baseline WebSocket fixture with `git show b031e6a…:server/tests/semantic_websocket.rs`; `git diff b031e6a… -- server/src/semantic/supervisor.rs server/tests/common/semantic_fixtures.rs` produced no differences. Extracted exact fenced patch via Python Eval and invoked `git apply --numstat -`: exit 128, corrupt patch at stdin line 19. No product build/test/lint/formatter rerun.

**Independent Cycle 3 tester:**

| Command | Result / evidence |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --lib semantic::overlay` | 9 passed, 0 failed; raw output inspected at artifact://133 |
| `cargo test --manifest-path server/Cargo.toml --lib semantic::uri` | 17 passed, 0 failed; raw output inspected at artifact://135 |
| `cargo test --manifest-path server/Cargo.toml --features test-support --test semantic_websocket -- --test-threads=1` | 17 passed, 0 failed, 245.44 s; raw output inspected at artifact://137 |
| `cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e test_packaged_tsls_lossless_cr_line_definition_and_ranged_edits` | Tester reports 1 passed, 0 failed, 4 filtered out; 16.74 s |
| `cargo check --manifest-path server/Cargo.toml --release --no-default-features` | Tester reports exit 0; no warnings/errors |

44 selected tests passed per tester. No coverage percentage, clippy/lint count, concurrent-harness execution, full TSLS suite, fresh all-target check, actual-web reveal or baseline replay established by this Cycle 3 evidence. After remediation, coordinator should run missing targeted races, feature-enabled normal harness, full tuple suite and all-target compile gate once; retain separate actual-web acceptance ownership.

## Unresolved questions

No user design decision required. Missing evidence: valid pristine-baseline replay; exact user-open-before-pin F3 scenario; held-child F9 cancellation and no-gap-dispatch logs; concurrent barrier isolation; saturated-publication cancellation/deadline/failure; bounded detached-read ownership; terminal-path map/full-capacity cleanup. These remain acceptance gaps, not claims disproved by the selected green tests.
