# Phase 01 — Editor content integrity

## Context links
- [Overview](./plan.md); [triage F1/F5/F6/F7](../reports/review-261025-0731-pr74.md); [frontend review](../reports/code-reviewer-261025-0731-pr74-frontend.md); [frontend execution](../reports/tester-261025-0731-pr74-frontend.md).
- [Architecture](../../docs/architecture/semantic-websocket-gateway.md#client-integration-shared-monaco-semantic-client-phase-07); original plan phases 07/08 overlap; do not edit them.

## Overview
Date: 2026-10-25. Completed: 2026-10-26 00:15:00 +07:00 (passed). Priority: P1. Status: complete, 100%. Owner: integration coordinator for architecture preflight; sequential editor/client implementer thereafter; coordinator owns final cross-phase evidence.

## Key Insights
- F1 is a conclusive static clean-reload/remount/wrapper chain where clean reload unmounts MonacoHost while `keepCurrentModel` preserves old text, and remount reuses the old model and saves with new mtime. Retention remains necessary for dirty undo. F1 is in core editor code and is reachable even with semantics OFF.
- F5/F6 were observed at actual-client/fake-transport boundaries; F7 probe proves BOM digest inequality only. Existing mocked wrapper tests cannot close F1.
- Pinned toolchain uses Monaco 0.55.1 and React wrapper 4.7.0. Pipeline behavior must be verified against exact pinned source rather than inferred from external versions.

## Requirements
- F1: Clean accepted reload and initial mount reconcile retained model from accepted unchanged store content using existing Monaco materialization before editing; preserve dirty undo, saved baselines, model EOL and save serialization. Deterministic failing-before evidence required on verified baseline `b031e6a` via disposable worktree before repair.
- F1 operational containment: Semantic OFF does not contain F1. Hold release, preserve/export unsaved drafts before browser reload/downgrade (never force-save), and rollback to verified unaffected release (`45a51efe43ef6024dbd875d2498b456a7d4db110`).
- F5: Retryable semantic socket loss recovers under the still-current owner; explicit release/disable/revoked credentials never revive it.
- F6: Rejected over-cap changes immediately invalidate source-query eligibility; admissible re-entry requires full text, even above 64 KiB.
- F7: One explicitly projected semantic snapshot for disk pin, editor sync, query and proof. Establish line/UTF-16 coordinate equivalence and edit commutation before implementing projection.
- Keep 1 MiB document/4 MiB session limits, FIFO ordering, immutable owner/incarnation fences, and all existing filesystem/store/save behavior. No global store/model normalization or new EOL/BOM save policy.

## Architecture
Representation scope: filesystem bytes/decoding, store content/savedContent, Monaco materialization/EOL and save serialization remain unchanged. Composed pipeline from disk to semantic representation:
1. Disk bytes are decoded by `b64ToUtf8` (`packages/ui/src/stores/editor.ts:305-310`) via `new TextDecoder()`, which strips one leading UTF-8 BOM (`U+FEFF`) by default.
2. Decoded string is materialized in Monaco 0.55.1 (`MonacoHost.tsx`). Hypotheses for bounded prerequisite to confirm against pinned source (`path:line`): Monaco's `PieceTreeTextBufferBuilder` extracts a leading `U+FEFF` and normalizes EOL delimiters; `model.getValue()` defaults to `preserveBOM: false`.
3. Candidate semantic projection $P$ converts EOL delimiters to LF while retaining all other model characters, including literal leading `U+FEFF`.
4. Pin intake on the server matches the composed frontend decoder/materialization treatment of disk BOM metadata exactly once, before pin/query/hash; never strip `U+FEFF` in generic hashing or editor projection. Query coordinates are computed against projected pin/wire text, and exact UTF-8 bytes are hashed.

Double-stripping named STOP/GO outcome:
- If a disk file contains two consecutive BOMs (`U+FEFF U+FEFF`), `TextDecoder` strips the first, leaving one literal `U+FEFF` in the store. If Monaco's buffer builder also extracts a leading BOM, the existing pipeline already double-strips.
- The bounded prerequisite must confirm whether Monaco extracts this second BOM. Decision rule: existing materialization is preserved and semantic projection follows the model text. If altering materialization is proposed, it is a scope change requiring user decision; do not alter materialization silently.
- Mixed-EOL: if Monaco normalizes EOL delimiters on model creation, existing save serialization preserves that existing behavior. Test controls assert current behavior, not raw-byte round-trip.

Bounded design prerequisite inside F7: inspect pinned Monaco 0.55.1 / wrapper 4.7.0 materialization, then prove $P$'s line-index / UTF-16-column mapping and $P(\text{applyModelChanges}(M, \Delta)) = \text{applyWireChanges}(P(M), P(\Delta))$ across the fixture matrix below before projection implementation. Establish actual pinned event-array order, whether ranges address pre-event text, and safe LSP sequential application order; never assume copying the array proves equivalence. Replacement text may be projected only under this proof; do not copy raw `rangeLength` / byte offsets where they no longer apply (omit deprecated `rangeLength` when unnecessary). Flush/EOL-only or otherwise unmappable events use existing bounded full projected replacement, never guessed ranges. Unproven mapping stops projection implementation and dependent gateway work pending explicit design correction.

Fixture matrix: 0, 1, and 2 disk BOMs, literal editor `U+FEFF`, every EOL form (LF, CRLF, lone CR, mixed EOL), first/later-line UTF-16/astral coordinates, multi-edits, CR/LF adjacency, flush/undo.

Clean reload acceptance uses a tab-local accepted-content revision distinct from mtime/model version, advanced only on successful clean load/reload. Mount captures revision + request generation + model identity/incarnation + owner. Reconcile only if tab still clean and revision/currentness match; suppress synthetic `onChange` from dirtying baseline. Once local reconciliation completes, editing is permitted independently of semantic OFF, unavailable transport or over-cap status. Separately, full-sync projected retained text via document queue before semantic-provider eligibility; never make editing depend on wire readiness. Assert model text matches existing Monaco materialization of accepted store independently of projection; never alter content/savedContent to manufacture equality. Dirty-during-read cannot be replaced. Explicit discard retains existing store/save semantics; no global model recreation or forced EOL.

Failing-before execution methodology for F1:
- Verified baseline: `b031e6a40123d8c5169012e0b736ac8c4f1f6091` against merge-base `45a51efe43ef6024dbd875d2498b456a7d4db110`.
- Execution: use a disposable worktree checked out at `b031e6a` with the new regression test overlaid. Run the test to observe failing-before overwrite: clean model V1 → external V2 accepted → edit/save overwrites V2 with V1+edit.
- If a test cannot compile against old baseline APIs, record an explicit exception and rationale rather than mutating history or weakening the test.
- Post-repair: run identical scenario passing with V2 retained, edit applied on V2, and save containing V2+edit.

A binding has explicit synchronization eligibility. Rejection, queued-send failure or replaced attempt makes it unsynchronized. Keep server-accounted bytes distinct from pending admitted reservations so adjacent queued edits cannot exceed session budget. Queries await that document's queue, then recheck current model/version/eligibility. Re-entry emits a range-less full `didChange` at a fresh monotonic version (or balanced close/open if the server retired it), clears unsynchronized only after existing successful FIFO/send fence, and never claims a new LSP acknowledgement. Unadmittable models remain query-blocked, including after reconnect.

Socket recovery reuses attempt retirement, existing one-second reconnect scheduler and handshake/replay barrier; no new retry framework. One timer per owner/client, gated by active refcount, enabled profile, current target/provenance and retryable close classification. Treat 4401/4403/1008 and explicit policy/disabled/removed-target outcomes as terminal; retry transient loss/internal transport failure only while authority remains current. New failure may schedule another single timer, never duplicate timers; timer and late attempt callbacks cannot affect replacement owners.

## Related code files
All writable paths below are rooted at `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration/`; exact per-task ownership is in the fence.
- Modify `packages/ui/src/stores/editor.ts`, `components/organisms/MonacoHost.tsx` and `EditorTabs.tsx` under `packages/ui/src/`: accepted-revision metadata and fenced clean mount reconciliation only; no intake decoding/normalization or save-policy change.
- Modify `packages/ui/src/api/semantic-client.ts`, `lib/semantic-model-uri.ts`, `lib/semantic-monaco.ts`, `stores/semantic-navigation.ts`: semantic-only projection/sync/proof, eligibility and attempt recovery.
- Modify `server/src/semantic/gateway.rs` and `overlay.rs`: bounded projected disk pin input before query; no filesystem/store/save rewrite.
- Extend existing unit/browser/E2E and Rust files enumerated in task ownership; no new production modules or deleted files required.
- Before source changes, modify `docs/architecture/semantic-websocket-gateway.md` and `docs/semantic-lsp-protocol-guide.md` with clearly labeled intended F1–F13 contract corrections; same coordinator reconciles actual outcomes at final integration.

## Implementation Steps
### record-remediation-architecture — prerequisite for all behavior changes
0. After user implementation approval, integration coordinator records this proposal's representation, proof, cancellation, replay/idle, auth deadline, publisher/config and failed-OFF invariants in existing architecture/protocol docs as intended design, not accomplished qualification. Check all thirteen findings and their existing boundary owners before any source change.
### semantic-text-representation — F7
1. First satisfy the bounded representation prerequisite above against exact pinned source and the fixture matrix: 0/1/2 disk BOM, literal editor `U+FEFF`, LF, CRLF, lone CR, mixed EOL, first-line symbols, empty/trailing lines, astral Unicode, multiple/cross-line edits, CR/LF adjacency, undo/redo and EOL-only changes. Confirm Monaco 0.55.1 / wrapper 4.7.0 materialization hypotheses and record line/UTF-16 mapping and edit-commutation results. Address double-stripping via the named STOP/GO outcome (projection follows model text). Block implementation if any mapping remains unproven.
2. Only after that gate, add small semantic projection helpers in existing model-URI/overlay modules, reusing unchanged text where possible. Apply solely to semantic snapshot reads, wire full/projected incremental replacement text, server pin/query inputs and proof consumers. Generic SHA remains byte-exact. Unmappable events use bounded full replacement; do not guess `rangeLength`.
3. Preserve every existing filesystem/store/model/save representation path, including dirty/saved baseline, mtime/size/conflict checks and explicit-save serialization. Add UI/Rust/browser regressions proving navigation/reveal and semantic coordinate equivalence without a new save policy; compare load/edit/save behavior to existing controls.
### reconcile-clean-reload — F1
4. Establish deterministic failing-before baseline evidence on verified commit `b031e6a` using a disposable worktree with test overlay: clean model V1 → external V2 → accepted reload → edit/save overwriting V2. Record failing-before run artifact.
5. Implement accepted revision and fenced mount reconciliation in `editor.ts`, `MonacoHost.tsx`, `EditorTabs.tsx`. Full-sync the retained changed model even if already wire-bound. Reuse existing read-only/loading handling until reconciliation completes; leave dirty mount/reconnect untouched.
6. Verify identical scenario passing: visible model reflects V2 via existing materialization, store retains accepted representation, overlay matches projected text, and saved content includes V2+edit under existing serialization. Also test Git-triggered reload, OFF semantics, equal mtime with changed accepted revision, dirty-during-read, dirty undo/redo and unchanged EOL/BOM save controls. Document operational containment in deployment guidance.
### fence-rejected-overlay-sync — F6
7. Add per-binding unsynchronized state and pending-byte accounting. Suppress both Definition and Implementation until bounded full re-entry; serialize and recheck after every await. Failed or retired queued work cannot mark a replacement binding synchronized.
8. Regress 1.1 MiB rejection at v1, query suppression, trim to 70 KiB, one full replacement before later ranges/query. Repeat at session aggregate cap with two queued models, plus failed send and reconnect with an oversized dirty model.
### recover-semantic-socket-loss — F5
9. Route unexpected close/error and existing -32005 recovery through one owner-fenced scheduler, with release/disable cancellation and terminal classifications. Replay current admissible dirty buffers before Ready; oversized buffers remain blocked.
10. Assert a distinct socket/attempt after observed disconnect, not merely an already-true Ready label; settle old requests and test retired callbacks, shared-mount release and no retry after final release/disable/auth failure.

## Todo list
```evcrate-tasks
[
  {
    "id": "record-remediation-architecture",
    "title": "Record intended remediation contracts before behavior changes",
    "blocked_by": [],
    "allowed_files": [
      "docs/architecture/semantic-websocket-gateway.md",
      "docs/semantic-lsp-protocol-guide.md"
    ],
    "constraints": [
      "Future approved implementation only; label intended changes separately from actual qualified behavior.",
      "One integration coordinator also owns final docs reconciliation; do not edit original plans or claim implementation from design text."
    ],
    "acceptance": [
      "Architecture/protocol state intended F1-F13 invariant corrections and representation/lifecycle/config ownership before source changes.",
      "No documentation claims a proposed repair or unexecuted probe already passed."
    ],
    "verification": [
      "Read architecture/protocol against all thirteen requirements and current source boundaries; record design-only consistency review, no product tests required for this prerequisite."
    ]
  },
  {
    "id": "semantic-text-representation",
    "title": "Align semantic-only pin, wire and proof projection (F7)",
    "blocked_by": [
      "record-remediation-architecture"
    ],
    "allowed_files": [
      "packages/ui/src/lib/semantic-model-uri.ts",
      "packages/ui/src/lib/semantic-monaco.ts",
      "packages/ui/src/api/semantic-client.ts",
      "packages/ui/src/components/organisms/MonacoHost.tsx",
      "packages/ui/src/lib/semantic-model-uri.test.ts",
      "packages/ui/src/lib/semantic-monaco.test.ts",
      "packages/ui/src/api/semantic-client.test.ts",
      "packages/ui/browser-tests/semantic-navigation.browser.tsx",
      "packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts",
      "server/src/semantic/gateway.rs",
      "server/src/semantic/overlay.rs",
      "server/tests/semantic_websocket.rs",
      "server/tests/semantic_tsls_e2e.rs"
    ],
    "constraints": [
      "First confirm pinned Monaco 0.55.1 / wrapper 4.7.0 materialization hypotheses and prove the line-UTF16 mapping and edit-commutation matrix; unproven mapping blocks projection implementation and dependents.",
      "Resolve double-stripping via the named STOP/GO outcome: projection follows model text; altering materialization is a scope change requiring user decision.",
      "Semantic projection only: preserve filesystem decoding, store content/savedContent, Monaco EOL/materialization and save serialization; no global normalization or new save policy.",
      "Handle disk BOM metadata at pin intake exactly once consistent with composed TextDecoder behavior, preserve literal editor U+FEFF, keep generic SHA byte-exact; use bounded full replacement for unmappable edits, not guessed ranges/rangeLength."
    ],
    "acceptance": [
      "BOM (0, 1, 2), literal editor U+FEFF, and each EOL fixture navigate/reveal first/later-line symbols with query/proof over identical projected text and proven line/UTF16 coordinates.",
      "Projection and mapped edit application commute for multi-edit/Unicode/undo/EOL fixtures; original store/model/save behavior and raw filesystem conflict checks remain unchanged.",
      "Load/navigation does not dirty/save files; changed semantic content and version/incarnation remain rejected independently of byte-equivalent EOL projections."
    ],
    "verification": [
      "Before projection implementation, inspect exact pinned source and exercise the representation matrix through isolated browser/TSLS fixtures; record proof receipt or block the bounded prerequisite.",
      "Run Phase 01 UI unit/browser and Phase 02 semantic_tsls_e2e commands plus final actual-web reveal; compare store/model/save controls and selected coordinates without modifying serialization policy."
    ]
  },
  {
    "id": "reconcile-clean-reload",
    "title": "Reconcile retained clean models without losing dirty undo (F1)",
    "blocked_by": [
      "semantic-text-representation"
    ],
    "allowed_files": [
      "packages/ui/src/stores/editor.ts",
      "packages/ui/src/stores/editor.test.ts",
      "packages/ui/src/components/organisms/MonacoHost.tsx",
      "packages/ui/src/components/organisms/EditorTabs.tsx",
      "packages/ui/src/components/organisms/MonacoHost.semantic.test.tsx",
      "packages/ui/src/components/organisms/EditorTabs.semantic.test.tsx",
      "packages/ui/browser-tests/semantic-navigation.browser.tsx",
      "packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts",
      "packages/ui/src/api/semantic-client.ts",
      "packages/ui/src/api/semantic-client.test.ts"
    ],
    "constraints": [
      "Execute deterministic failing-before check on verified baseline b031e6a using a disposable worktree with test overlay; record evidence before applying fix.",
      "Apply only current accepted clean revision under request/model/owner fences; never globally recreate retained models.",
      "Preserve existing store/saved baseline, decoder, Monaco EOL/materialization and save serialization; store changes are accepted-revision metadata only.",
      "Preserve dirty model identity/undo and mtime conflict semantics, including edits racing reload.",
      "Enforce operational containment: semantics OFF does not disable F1; specify release hold, draft preservation/export before reload/downgrade, and rollback target 45a51ef."
    ],
    "acceptance": [
      "Baseline b031e6a demonstrates deterministic overwrite failure in disposable worktree before repair.",
      "After V1-to-V2 clean external/Git reload, retained model matches existing Monaco materialization of unchanged accepted store content before editing; projected snapshot equals synchronized overlay.",
      "Subsequent save includes V2 plus new edit using unchanged serialization; dirty tab-switch/reconnect undo and dirty-during-read/obsolete-owner fences hold."
    ],
    "verification": [
      "Run failing-before test on baseline b031e6a worktree and record artifact; run identical passing test after fix.",
      "Run Phase 01 unit/browser commands with real pinned wrapper reload/remount; independently check accepted model materialization and semantic projection equality.",
      "Run final actual-web external-edit/reload/save journey ON/OFF with EOL/BOM save-behavior controls; inspect disposable disk/store/model without normalizing baselines."
    ]
  },
  {
    "id": "fence-rejected-overlay-sync",
    "title": "Block stale navigation until bounded full resync (F6)",
    "blocked_by": [
      "reconcile-clean-reload"
    ],
    "allowed_files": [
      "packages/ui/src/api/semantic-client.ts",
      "packages/ui/src/api/semantic-client.test.ts",
      "packages/ui/src/lib/semantic-model-uri.ts",
      "packages/ui/src/lib/semantic-model-uri.test.ts",
      "packages/ui/src/lib/semantic-monaco.ts",
      "packages/ui/src/lib/semantic-monaco.test.ts"
    ],
    "constraints": [
      "Keep existing negotiated caps and FIFO/version fences; include pending reservations and never send partial deltas against a rejected baseline."
    ],
    "acceptance": [
      "Rejected 1.1 MiB and aggregate-over-cap changes send no stale source navigation.",
      "Re-entry at 70 KiB sends full text at a fresh version before any query/range; send failure, reconnect and replacement binding cannot falsely restore eligibility."
    ],
    "verification": [
      "Run Phase 01 semantic-client and semantic-monaco unit regressions with asserted wire messages, versions and queued byte totals.",
      "Run final real-TSLS dirty-buffer cap/re-entry journey and confirm result matches the accepted model."
    ]
  },
  {
    "id": "recover-semantic-socket-loss",
    "title": "Recover retryable semantic transport loss under exact owner (F5)",
    "blocked_by": [
      "fence-rejected-overlay-sync"
    ],
    "allowed_files": [
      "packages/ui/src/api/semantic-client.ts",
      "packages/ui/src/api/semantic-client.test.ts",
      "packages/ui/src/stores/semantic-navigation.ts",
      "packages/ui/src/stores/semantic-navigation.test.ts",
      "packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts"
    ],
    "constraints": [
      "Reuse existing one-second scheduler and replay barrier; one timer, no retry of terminal authority/policy failures.",
      "Cancel on final release, disable and owner retirement; old attempt callbacks never close a replacement."
    ],
    "acceptance": [
      "Unexpected retryable close with stable core owner produces a new semantic attempt, full dirty replay then Ready.",
      "Explicit release/disable/auth failure yields no reconnect; outstanding old requests settle and shared surviving mounts retain service."
    ],
    "verification": [
      "Run Phase 01 client/store tests with fake timers and distinct socket IDs; run final actual-web forced semantic-only socket loss with unchanged core connection."
    ]
  }
]
```
- [x] <!-- evcrate-task:record-remediation-architecture --> Record intended architecture contracts before behavior changes. (Completed 2026-10-26)
- [x] <!-- evcrate-task:semantic-text-representation --> Establish semantic text representation. (Completed 2026-10-26)
- [x] <!-- evcrate-task:reconcile-clean-reload --> Reconcile accepted clean reloads. (Completed 2026-10-26)
- [x] <!-- evcrate-task:fence-rejected-overlay-sync --> Fence rejected overlay sync. (Completed 2026-10-26)
- [x] <!-- evcrate-task:recover-semantic-socket-loss --> Recover owner-current socket loss. (Completed 2026-10-26)

## Success Criteria
All four finding regressions pass, including actual-wrapper/browser and live-TSLS/full-app evidence; unit doubles alone cannot close F1/F7. Planned commands from repository root:
- `pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/lib/semantic-monaco.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx`
- `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx`
- Compile once at integration: `pnpm --filter @dam-hopper/ui build`; actual-web command and fixture prerequisites in Phase 04. No command executed by this author.

### Completion and Verification Record
- **Completed:** 2026-10-26 00:15:00 +07:00
- **Status:** Complete / Passed (Work cycle closed with auditable carryovers W1–W7 tracked for downstream phases; release hold maintained)
- **Reported Verification Evidence:**
  - UI Unit & Semantic Tests: 7 files passed, 103 tests passed (`src/stores/editor.test.ts`, `src/api/semantic-client.test.ts`, `src/lib/semantic-model-uri.test.ts`, `src/lib/semantic-monaco.test.ts`, `src/stores/semantic-navigation.test.ts`, `src/components/organisms/MonacoHost.semantic.test.tsx`, `src/components/organisms/EditorTabs.semantic.test.tsx`)
  - Vitest Chromium Browser Tests: 1 file passed, 10 tests passed in Chromium (`browser-tests/semantic-navigation.browser.tsx`)
  - UI Build & Type Safety: `pnpm --filter @dam-hopper/ui build` completed with exit 0 (zero compiler diagnostics)
  - Server Rust Unit Tests: `cargo test --manifest-path server/Cargo.toml test_project_disk_text_for_pin` (1 passed)
  - Server Rust Integration Tests: `cargo test --manifest-path server/Cargo.toml --test semantic_websocket` (11 passed)
  - Tester Report: `plans/reports/tester-261026-0002-phase01-editor-content-integrity-cycle3.md`
  - Review Report: `plans/reports/code-review-261026-0004-phase01-editor-content-integrity-cycle3.md` (C1 static fix confirmed; warnings W1–W7 recorded as carryovers below)
- **Auditable Downstream Carryovers:**
  - **W1 (Delayed mount callback freshness):** `handleMount` captures stale `reconcileModelWithStore` callback on semantic toggle; tracked for Phase 02/04 regression.
  - **W2 (Model text rematerialization):** Replay/resync and destination proof strip literal leading BOM a second time; tracked for Phase 02 coordinate proof reconciliation.
  - **W3 (Failed-send fallback invalidation & version order):** Fallback catch clears unsynchronized without preserving newer rejection generation; tracked for Phase 02/03 client/gateway fencing.
  - **W4 (Pending reservation failure path):** Runnable reservation survival on send error; tracked for Phase 03 capacity verification.
  - **W5 (Browser error-to-close recovery):** Error recording and close reconnect scheduling; tracked for Phase 03 lifecycle.
  - **W6 (Integrated qualification receipts):** Baseline `b031e6a` failing-before overwrite artifact and real-wrapper/live-TSLS reload→edit→save journey; tracked for Phase 04 integrated qualification.
  - **W7 (Range length omission):** Addressed statically in `MonacoHost.tsx`; multi-edit regression tracked for Phase 04.
## Risk Assessment
Projection may conceal incorrect model materialization if checked only through its SHA; assert accepted model content separately and preserve store/save behavior. Pinned-source/fixture coordinate proof is a blocking design prerequisite, not completed evidence. Queued resync/reload can self-trigger changes; fence synthetic application and currentness. Semantics OFF does NOT contain F1; operational containment requires release hold, draft preservation/export before reload/downgrade (no force-save), and rollback to verified unaffected base `45a51ef`.

## Security Considerations
Recovery must not replay foreign owner/actor/root text, retry revoked credentials, persist drafts, or log tokens/content. Hash canonical query text without weakening identity/version checks. Source unsynchronized means fail closed, not local semantic-provider fallback presented as server freshness.

## Next steps
Phase 02 consumes the representation contract; Phase 03 proceeds independently except final integration. Parent/coordinator collects fresh evidence only after authorized implementation.

## Unresolved questions
F7 bounded prerequisite confirmed against pinned Monaco 0.55.1 / wrapper 4.7.0 materialization and BOM/EOL intake in unit/browser fixtures (`semantic-model-uri.test.ts`, `semantic-navigation.browser.tsx`, `test_project_disk_text_for_pin_boms_and_eols`); double-stripping STOP/GO outcome followed model text. Full-app real-server overwrite/reveal qualification remains tracked for Phase 04 integration.
