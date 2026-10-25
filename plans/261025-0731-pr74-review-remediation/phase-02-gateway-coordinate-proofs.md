# Phase 02 — Gateway coordinate proofs

## Context links
- [Overview](./plan.md); [Phase 01 representation](./phase-01-editor-content-integrity.md#architecture); [triage F3/F8/F9](../reports/review-261025-0731-pr74.md).
- [Gateway review](../reports/code-reviewer-261025-0731-pr74-gateway.md); [backend execution](../reports/tester-261025-0731-pr74-backend.md); [protocol research, version caveat retained](../reports/researcher-261025-0731-pr74-protocol.md).
- [Current architecture](../../docs/architecture/semantic-websocket-gateway.md); [protocol](../../docs/semantic-lsp-protocol-guide.md). Original phases 04/05/07/08 share these contracts; no edits to original plan.

## Overview
Date: 2026-10-25. Priority: P1. Status: pending, 0%. Owner: sequential gateway implementer; integration coordinator owns final proof acceptance.

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
- [ ] <!-- evcrate-task:support-lossless-cr-lines --> Support lossless CR coordinates.
- [ ] <!-- evcrate-task:preserve-query-snapshot-proof --> Preserve query snapshot proof.
- [ ] <!-- evcrate-task:retain-logical-navigation-cancellation --> Retain logical cancellation ownership.

## Success Criteria
All three missing-edge regressions and stable controls pass. Planned root commands are in the task fence; integration also runs `cargo check --manifest-path server/Cargo.toml --all-targets` once after all changes. Rust fixture TMPDIR must be a disposable disk-backed location with sufficient quota; retain failures/retries verbatim. Existing 101-pass aggregate is baseline only. No command or new race reproduction executed by this author.

## Risk Assessment
Locks across map changes can deadlock if ordering diverges; retain one documented ordering and avoid synchronous locks across awaits. Test barriers belong only to existing fixture/test boundaries and must not ship runtime controls. Proof validation can safely reject more races, but stable-result positive controls prevent turning navigation into always-empty success. Roll back exposure via OFF rather than bypass proof/cancellation checks.

## Security Considerations
Do not emit internal proven text, physical paths or `_damHopperProvenSnapshots`. Keep final authority/revocation fence immediately before publication. Cancellation cannot release a logical ID early enough for an old response to attach to a reused ID; source and destination incarnations remain independent.

## Next steps
Phase 04 integrated verification consumes proof/cancellation regressions and Phase 01 real-browser acceptance. Phase 03 has separate actor/upgrade ownership; avoid concurrent writes to shared regression files if scope is revised.

## Unresolved questions
Runtime frequency of these gateway interleavings remains unmeasured; deterministic regression with channel barriers is required, not an estimate or claim of exploitation.
