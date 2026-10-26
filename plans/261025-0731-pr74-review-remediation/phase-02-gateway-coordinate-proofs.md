# Phase 02 — Gateway coordinate proofs

## Context links
- [Overview](./plan.md); [Phase 01 representation](./phase-01-editor-content-integrity.md#architecture); [triage F3/F8/F9](../reports/review-261025-0731-pr74.md).
- [Gateway review](../reports/code-reviewer-261025-0731-pr74-gateway.md); [backend execution](../reports/tester-261025-0731-pr74-backend.md); [protocol research, version caveat retained](../reports/researcher-261025-0731-pr74-protocol.md).
- [Current architecture](../../docs/architecture/semantic-websocket-gateway.md); [protocol](../../docs/semantic-lsp-protocol-guide.md). Original phases 04/05/07/08 share these contracts; no edits to original plan.

## Overview
Date: 2026-10-25. Completed: 2026-10-26 07:30:00 +07:00 (DONE — accepted with deferred issues tracked for Phase 04). Priority: P1. Status: complete, 100% (administrative closure; technical acceptance pending Phase 04 integrated qualification). Owner: sequential gateway implementer; integration coordinator owns final proof acceptance.

## Key Insights
- F3: Session already returns immutable `_damHopperProvenSnapshots`; gateway later replaces proof with live text while retaining earlier coordinates. Existing before/after maps do not prevent relabeling when destination changes between requery and live capture.
- F8 was observed in production Rust range/offset helpers. Matching TypeScript 5.9.3 recognizes lone CR; direct-client text must not be rewritten.
- F9: Initial child completion was treated as logical request completion, dropping logical registration and token tracking during pin acquisition and second child query. Cancellation during that gap fails to cancel active work.
- F3 and F9 require deterministic failing-before baseline evidence on verified commit `b031e6a` before applying repairs.

## Requirements
- F3: Every emitted in-target location/link range must be validated and labeled against the exact immutable snapshot used by that query. Source/destination version/incarnation changes reject or are caught by unchanged proof at client, never relabeled. Deterministic failing-before evidence on baseline `b031e6a` required.
- F8: LF, CRLF and lone CR line boundaries, trailing empty lines and UTF-16 columns work without rewriting direct-client overlay text or shifting byte offsets.
- F9: One logical client registration, cancellation token, deadline and permit span both child stages, disk reads/pin acquisition and publication; reuse is rejected until terminal completion. Deterministic failing-before evidence on baseline `b031e6a` required.
- Keep filtered methods, virtual-only URIs, containment, max eight in-flight requests, original client IDs and one terminal response per logical request.

## Architecture
Use the existing session response-carried proven snapshot set as sole coordinate proof for requery. Parse/retain immutable text, SHA, version and open incarnation; remove internal metadata before outbound serialization. Membership alone is insufficient. Current live snapshots may reject change, never replace proof. Validate all final destinations against exact proof/source snapshot; missing/malformed proof fails closed. For unopened pins, consume Phase 01's proven semantic-only projection before query; later model projection compares against that proof to reject changed semantic text, not every raw-byte/EOL change. Retain filesystem freshness and version/incarnation checks independently. A user-open destination replacing a pin uses the actor's exact requery snapshot.

One shared lossless line-span iterator in existing `overlay.rs` yields borrowed line text plus starting byte offset; recognize CRLF as one separator, LF/CR as one, and preserve final empty line. `position_to_byte_offset` and `uri.rs` range validation consume it without per-line allocations or rewriting direct-client overlays. Retain current invalid-position/surrogate-split policy. Phase 01's conditional semantic-only LF projection affects only pins/wire/proof after coordinate equivalence is established, never store/model/save representations; raw direct clients still require lossless CR support.

Keep one gateway logical entry keyed by original JSON-RPC ID through terminal publication. It owns cancellation state and optional active child ID; reverse mapping changes when stage two is admitted, but never loses the logical entry. Cancellation in the gap marks the entry before another child starts. Recheck it after disk/pin awaits and before publication; cancel active child if present. Retain existing overall deadline across stages rather than restarting the clock. Terminal cleanup releases mappings/permit exactly once on success, error, cancel, timeout, revocation or channel failure; late child replies are ignored. Reuse existing map/token/guard patterns, not a general request framework.

Deterministic failing-before and barrier methodology for F3 and F9:
- Verified baseline: `b031e6a40123d8c5169012e0b736ac8c4f1f6091` against merge-base `45a51efe43ef6024dbd875d2498b456a7d4db110`.
- Execution: use a disposable worktree at `b031e6a` with test overlay.
- For F3: run deterministic interleaving: destination absent at submission → user-open A before pin → query against A → pause after gateway map capture via channel barrier → change destination to B → resume. On baseline `b031e6a`, observe A coordinates relabeled with live B proof.
- For F9: run deterministic cancellation: hold inter-stage pin gap or held second child reply via channel barrier, inject cancel from client. On baseline `b031e6a`, observe cancellation ignored or second child request launched without cancellation tracking.
- If a test cannot compile against old baseline APIs, record an explicit exception and rationale rather than mutating history or weakening the test.
- Barrier design: use deterministic async synchronization (e.g. `tokio::sync::oneshot` / `tokio::sync::Notify`), never sleeps or timing guesses. Fixture/quota failures do not count as defect reproductions.

## Related code files
Writable paths are repository-relative under `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration/`.
- Modify `server/src/semantic/overlay.rs`, `uri.rs`: shared borrowed lossless line spans and helper unit regressions.
- Modify `server/src/semantic/gateway.rs`: consume exact session proof; retain logical cancellation ownership through all stages.
- Extend `server/tests/semantic_websocket.rs` deterministic G5 fixture and `server/tests/semantic_tsls_e2e.rs` actual pinned-engine cases. No production modules/files deleted or added.
- Read-only interface: `server/src/semantic/session.rs` proof emission and pinned-navigation submission. Escalate a required interface change rather than silently editing unowned files.

## Implementation Steps
### support-lossless-cr-lines — F8
1. Add shared borrowed line scanning in `overlay.rs`; switch both position offset and destination range validation to it. Keep byte accounting over original direct-client text.
2. Test empty documents, each EOL form, mixed separators, CRLF boundary, trailing separators, multibyte UTF-8, astral UTF-16 and invalid surrogate columns; assert exact offsets and edit-result bytes.
3. Real TSLS fixture: LF source imports CR-only destination with definition on line 2 or later; direct protocol CR overlay accepts ranged edit on that later line. Proven semantic-projection pin path and raw direct overlay path both resolve, with no store/model/save representation changes.
### preserve-query-snapshot-proof — F3
4. Establish deterministic failing-before evidence on baseline `b031e6a` worktree: destination absent at submission → user-open A before pin → query against A → pause after gateway map capture via channel barrier → change to B → resume. Observe relabeling failure on baseline and record run artifact.
5. In `gateway.rs`, consume response proof for the requery's final result. Remove live-provenance refresh; validate URI membership, exact text digest, version/incarnation and current source/destination identity where user-open.
6. Verify identical scenario passing: no A coordinates with B SHA/version emitted; stale rejection or immutable A proof rejected at client is observed, never successful stale reveal. Cover close/reopen with new incarnation, source mutation, missing proof and BOM/mixed-EOL projected pins.
### retain-logical-navigation-cancellation — F9
7. Establish deterministic failing-before evidence on baseline `b031e6a` worktree: hold pin gap and second child response separately with channel barriers; inject cancellation. Observe dropped cancellation ownership on baseline and record run artifact.
8. In `gateway.rs`, keep logical registration until final response; update active child map atomically with cancellation checks. Use the original request ID for -32800 and retain duplicate-ID rejection throughout.
9. Verify identical scenario passing: gap cancellation prevents stage two launch; stage-two cancellation returns one -32800 with original ID and cancels active child. Duplicate-ID reuse before terminal response is rejected. Capacity and mappings release cleanly across success, error, cancel, timeout, revocation and channel failure.

## Todo list
```evcrate-tasks
[
  {
    "id": "support-lossless-cr-lines",
    "title": "Share lossless CR, CRLF and LF coordinate scanning (F8)",
    "blocked_by": [
      "semantic-text-representation"
    ],
    "allowed_files": [
      "server/src/semantic/overlay.rs",
      "server/src/semantic/uri.rs",
      "server/tests/semantic_tsls_e2e.rs"
    ],
    "constraints": [
      "Borrow original slices and retain UTF-16/byte offsets; do not normalize direct-client overlay text or add avoidable per-line allocations."
    ],
    "acceptance": [
      "Valid later-line positions and ranged edits work for CR, CRLF, LF and mixed separators with exact byte offsets.",
      "Trailing empty line and astral/surrogate boundary regressions preserve existing validation policy; real tuple resolves a later-line CR-only definition."
    ],
    "verification": [
      "Run cargo test --manifest-path server/Cargo.toml --lib semantic::overlay and cargo test --manifest-path server/Cargo.toml --lib semantic::uri.",
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e with the verified tuple and sufficient fixture disk space."
    ]
  },
  {
    "id": "preserve-query-snapshot-proof",
    "title": "Keep final navigation proof tied to exact requery inputs (F3)",
    "blocked_by": [
      "support-lossless-cr-lines"
    ],
    "allowed_files": [
      "server/src/semantic/gateway.rs",
      "server/tests/semantic_websocket.rs",
      "server/tests/semantic_tsls_e2e.rs"
    ],
    "constraints": [
      "Execute deterministic failing-before check on verified baseline b031e6a using a disposable worktree with test overlay; record evidence before applying fix.",
      "Use deterministic async channel barriers, never sleeps or timing guesses; fixture/quota failures are not defect reproductions.",
      "Consume existing response-carried proven snapshots; current snapshots only reject differences and never replace proof.",
      "Use only Phase 01's proven semantic projection before query; do not modify store/model/save representation or confuse semantic SHA with raw-byte freshness.",
      "No live coordinate relabeling, digest-only repair, new protocol trust shortcut or production race scaffolding."
    ],
    "acceptance": [
      "Baseline b031e6a demonstrates deterministic A-coordinate/B-proof relabeling failure in disposable worktree before repair.",
      "Deterministic A-query/B-edit interleaving after repair never emits A coordinates labeled with B SHA/version.",
      "Close/reopen incarnation change, source mutation and malformed/missing proof fail closed; stable projected destination positive control succeeds with proven BOM/EOL line-UTF16 mapping."
    ],
    "verification": [
      "Run failing-before test on baseline b031e6a worktree and record artifact; run identical passing test after fix.",
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_websocket, including barrier-controlled freshness cases.",
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e and final actual-web destination-reveal regression with unchanged store/save controls."
    ]
  },
  {
    "id": "retain-logical-navigation-cancellation",
    "title": "Retain logical cancellation and ID ownership through requery (F9)",
    "blocked_by": [
      "preserve-query-snapshot-proof"
    ],
    "allowed_files": [
      "server/src/semantic/gateway.rs",
      "server/tests/semantic_websocket.rs"
    ],
    "constraints": [
      "Execute deterministic failing-before check on verified baseline b031e6a using a disposable worktree with test overlay; record evidence before applying fix.",
      "Use deterministic barrier synchronizers at pin gap and stage-two awaits, never sleeps or timing guesses.",
      "Keep original client ID/token/deadline/permit until exactly one terminal outcome; reuse existing maps/guards rather than a framework.",
      "Cancel at inter-stage awaits and active child, and suppress all late completions after terminal cleanup."
    ],
    "acceptance": [
      "Baseline b031e6a demonstrates dropped cancellation ownership in disposable worktree before repair.",
      "Gap cancellation prevents requery; stage-two cancellation returns one -32800 with original ID and cancels active child.",
      "ID reuse before terminal response is rejected; success/error/timeout/revocation/channel failure release mappings and in-flight capacity exactly once."
    ],
    "verification": [
      "Run failing-before test on baseline b031e6a worktree and record artifact; run identical passing test after fix.",
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_websocket with deterministic gap/second-reply barriers and positive completion controls.",
      "Record actual terminal frame IDs, child cancel IDs, final map/counter state and unchanged overall deadline."
    ]
  }
]
```
- [x] <!-- evcrate-task:support-lossless-cr-lines --> Support lossless CR coordinates. (Completed 2026-10-26)
- [x] <!-- evcrate-task:preserve-query-snapshot-proof --> Preserve query snapshot proof. (Completed 2026-10-26)
- [x] <!-- evcrate-task:retain-logical-navigation-cancellation --> Retain logical cancellation ownership. (Completed 2026-10-26)

## Success Criteria
Required acceptance criteria for final technical sign-off: All three missing-edge regressions and stable controls pass, with clean baseline failing-before evidence and deterministic barrier isolation. Planned root commands are in the task fence; integration also runs `cargo check --manifest-path server/Cargo.toml --all-targets` once after all changes. Rust fixture TMPDIR must be a disposable disk-backed location with sufficient quota; retain failures/retries verbatim. Existing 101-pass aggregate is baseline only.

### Completion and Verification Record
- **Completed:** 2026-10-26 07:30:00 +07:00
- **Status:** DONE (accepted with deferred issues tracked for Phase 04; work cycle closed by coordinator direction; technical acceptance remains open pending Phase 04 integrated qualification and resolution of warnings W1, W3, W4, W5, W7, W8, W9; release hold maintained)
- **Reported Verification Evidence:**
  - Lossless Line Scanning Unit Tests: 9 reported passed in Cycle 3 tester output (`cargo test --manifest-path server/Cargo.toml --lib semantic::overlay`)
  - URI Range & Path Unit Tests: 17 reported passed in Cycle 3 tester output (`cargo test --manifest-path server/Cargo.toml --lib semantic::uri`)
  - Gateway WebSocket Integration Tests: 17 reported passed in Cycle 3 tester output (`cargo test --manifest-path server/Cargo.toml --features test-support --test semantic_websocket -- --test-threads=1`)
  - Real Packaged TSLS E2E: 1 reported passed in Cycle 3 tester output (`cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e test_packaged_tsls_lossless_cr_line_definition_and_ranged_edits`)
  - Release Feature Configuration Check: `cargo check --manifest-path server/Cargo.toml --release --no-default-features` reported exit 0 (no warnings/errors; `test-support` feature no longer included by default)
  - Review Report: `plans/reports/code-review-261026-0709-phase02-gateway-coordinate-proofs-cycle3.md` (Score 6/10; 0 critical; C1/W6 statically resolved; production default exclusion resolved; 7 warnings tracked as deferred carryovers below)
- **Auditable Downstream Carryovers (Tracked for Phase 04):**
  - **W1 (High — CI feature wiring & process-global barriers):** Feature cutover silently removes gateway coverage from default CI; `test-support` feature is required for `semantic_websocket` target but omitted from `.github/workflows/pr-quality-gate.yml` and test commands; BarrierGuard flags remain process-global. Phase 04 integration must wire `--features test-support` into CI workflows/runners and enforce serialized/isolated test teardown that wakes paused workers.
  - **W3 (High — Outbound admission cancellation/deadline race):** In `gateway.rs`, `finish` checks cancellation but builds `final_msg` before awaiting channel/byte capacity; cancellation during capacity wait is not rechecked before commit, and send timeout extends beyond navigation deadline. Phase 04 must reserve capacity under navigation deadline and recheck cancellation immediately before non-awaiting commit.
  - **W4 (Medium — Incomplete navigation deadline coverage):** Absolute navigation deadline starts after first-stage submission; post-requery source snapshot read and cleanup child-cancel enqueue are not bounded by navigation deadline. Phase 04 must unify deadline across all owned awaits.
  - **W5 (High — F3/F9 test coverage fidelity):** Interleaving test in `semantic_websocket.rs` queries disk pin A, then first user-opens B after capture (does not cover absent-at-submission → user-open A before pin → query A → edit B); stage two replies immediately; child cancellation logs absent; saturation recovery relies on 60 ms timing. Phase 04 must implement exact planned F3 interleaving, child request/cancel logs, and deterministic saturation recovery.
  - **W7 (Medium — Corrupt baseline diff & API incompatibilities):** `baseline-b031e6a-f3-f9-failing-before.md` diff headers have mismatched line counts (git apply exit 128) and reference non-existent fixture APIs (`make_test_app`, synchronous supervisor constructor). Phase 04 must record a clean, replayable baseline diff and digest against `b031e6a`.
  - **W8 (Medium — Transport termination on enqueue failure):** Enqueue failure revokes session token but does not signal transport cancellation or close outbound admission, potentially leaving slow-progressing writer live. Phase 04 must invoke connection termination on terminal enqueue failure.
  - **W9 (High — Off-thread read bounds & worker lifetime):** Off-thread snapshot read uses `fs::read_to_string` without byte limit or descriptor pinning; `spawn_blocking` JoinHandle timeout drops handle rather than aborting worker. Phase 04 must reuse bounded regular-file snapshot reader and retain worker permits until blocking completion.

## Risk Assessment
Locks across map changes can deadlock if ordering diverges; retain one documented ordering and avoid synchronous locks across awaits. Test barriers belong only to existing fixture/test boundaries and must not ship runtime controls. Proof validation can safely reject more races, but stable-result positive controls prevent turning navigation into always-empty success. Roll back exposure via OFF rather than bypass proof/cancellation checks.

## Security Considerations
Do not emit internal proven text, physical paths or `_damHopperProvenSnapshots`. Keep final authority/revocation fence immediately before publication. Cancellation cannot release a logical ID early enough for an old response to attach to a reused ID; source and destination incarnations remain independent.

## Next steps
Phase 04 integrated verification consumes proof/cancellation regressions and Phase 01 real-browser acceptance. Phase 03 has separate actor/upgrade ownership; avoid concurrent writes to shared regression files if scope is revised.

## Unresolved questions
Runtime frequency of these gateway interleavings remains unmeasured; deterministic regression with channel barriers is required, not an estimate or claim of exploitation.
