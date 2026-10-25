# Phase 01 — Editor content integrity review

**Score: 4/10 — changes requested; Phase 01 not acceptance-complete.**

Scope: all 15 supplied changed files; supporting EditorTabs, semantic client/provider lifecycle, phase/overview requirements, PDR and code standards. Static review only by this reviewer; execution evidence attributed to the tester below. No product or plan edits. Loaded published `code-review/SKILL.md` directly.

## Critical issues

### C1 — Deferred store reconciliation can mutate a replacement/current model without its acceptance fences
- **Evidence:** `packages/ui/src/stores/editor.ts:1263-1271`; compare request/provenance checks at `1213-1216` and requirements in phase `:39` / `:155-160`.
- New fire-and-forget dynamic import captures `decoded` and the original tab, then checks only that a tab of the same key is currently clean. It does not recheck request generation, accepted revision/content, connection/provenance, or captured model/incarnation. A superseded reload/closed-and-reopened tab can therefore have its current retained model overwritten by an older read after the async boundary. It also bypasses MonacoHost's synthetic-change suppression; on an attached model its `setValue` can publish a synthetic edit/dirty state and erase undo.
- **Impact:** renewed editor/store divergence and potential subsequent save of obsolete content; reachable with semantics OFF. **Confidence:** high, static async-fence violation; runtime reproduction not executed here.
- **Correction:** consolidate reconciliation in one attachment owner rather than store + component. Recheck accepted revision/request/owner/model identity immediately before applying, preserve existing materialization, suppress synthetic changes, and release local editing independently of semantic readiness.

## Warnings

### W1 — Clean reload remount repairs text but skips existing wire-binding synchronization (High)
- **Evidence:** `MonacoHost.tsx:285-288,346-355,545-572`; `semantic-client.ts:929-936`; supporting `EditorTabs.tsx:646-650`.
- Loading unmounts the host. The replacement initializes `reconciledRevisionRef` to the already-accepted revision; mount also records that revision. The revision effect consequently sends no full change. Registration calls `notifyDidOpen`, which is a no-op for an already-bound model. Synthetic reconciliation is deliberately suppressed, so it cannot supply the missing didChange either.
- **Impact:** retained visible V2 can remain associated with server V1 until another edit; navigation can use obsolete source content. **Confidence:** high, static path.
- **Correction:** explicitly enqueue a full projected snapshot of the reconciled actual model for an existing binding before provider/query eligibility; do not gate editing on that send. Regress the actual loading/unmount/remount path with a real client.

### W2 — F7 projection is not applied end to end (High)
- **Evidence:** `MonacoHost.tsx:212,568-571,700`; unchanged `EditorTabs.tsx:207-214`; `semantic-client.ts:860-889,1160,1373-1388`; `semantic-monaco.ts:212`.
- Host edits are projected, but replay/resync still read raw store content. Existing-destination validation still hashes raw `destinationModel.getValue()`. Thus a CRLF document can open/replay in CRLF, later change to LF, and fail destination proof against the projected gateway pin. A two-BOM disk file also leaves a store-leading BOM that the actual Monaco model removes; projecting store text alone cannot match the model snapshot.
- **Impact:** false freshness rejection or inconsistent wire/proof baselines after opening, recovery and resync. **Confidence:** high.
- **Correction:** make all semantic consumers read the same projected materialized model snapshot, with an equivalent proven path for non-mounted models. Preserve raw store/saved content and generic SHA behavior.

### W3 — Older queued work can clear a newer rejection; in-flight queries do not recheck eligibility (High)
- **Evidence:** `semantic-client.ts:1012-1023,1036-1065,1289-1297`.
- An admissible change queues work; a following synchronous over-cap change sets `unsynchronized=true` without advancing wireVersion. When the older queued task runs, it sends its older snapshot and unconditionally clears the flag. A query waiting on that queue can then run against stale content. Separately, an already-running navigation can return after rejection because its completion fence checks incarnation/session/version but not `unsynchronized`; the rejected change did not bump that version.
- **Impact:** F6's fail-closed guarantee does not hold for adjacent edits or existing requests. Clearing the global reveal intent does not retire provider request epochs.
- **Confidence:** high, static queue ordering.
- **Correction:** fence successful synchronization to the precise admitted/current content generation; older tasks cannot clear newer invalidation. Recheck eligibility on query completion and invalidate outstanding navigation on rejection. Test synchronous admitted→rejected edits and rejection during an outstanding response.

### W4 — Pending reservations neither represent FIFO peaks nor enforce exact admission (High)
- **Evidence:** `semantic-client.ts:817-837,1014,1019,1037,1065`.
- Admission adds other documents' server bytes and pending full sizes, double-counting one document; e.g. open A=100/B=100, pending A=150, next B=150 is counted as 400 rather than 300. Conversely, one mutable entry per tab loses earlier larger queued reservations when later smaller edits overwrite it, and every task/rejection deletes that entry regardless of newer queued work. Example under a 1500-byte session cap: open A=100/B=100; queue A=1000, A=100, then B=1000 and B=100. The overwritten reservations admit both growths, while FIFO delivery can temporarily produce A=1000/B=1000.
- **Impact:** both false rejection and violation of negotiated session admission bounds. **Confidence:** high, static accounting.
- **Correction:** account for server-held bytes plus queue-owned reservations with correct replacement/peak semantics; release each reservation by its own task identity. Cover real adjacent queued documents, not only awaited sequential updates.

### W5 — Browser error events disable the reconnect path (High)
- **Evidence:** `semantic-client.ts:628-658,1321-1335`.
- `onerror` retires the attempt with status `error` and schedules nothing. Its subsequent `onclose` is ignored because the attempt is retired. Therefore the normal browser error→close sequence never reaches the newly added retry scheduler. Existing new coverage invokes close directly (`semantic-client.test.ts:1622-1627`).
- **Impact:** transient transport/connection failures remain stuck under a stable owner; F5 only repairs close-only loss. **Confidence:** high.
- **Correction:** coordinate error/close retirement so retryable errors reach the same single scheduler without losing terminal close classification; regress error→close and repeated failed recovery attempts.

### W6 — Representation proof and F1 regression gates are not established by the passing tests (High)
- **Evidence:** `semantic-model-uri.test.ts:442-543` computes `modelApplied` but never compares it with wire application; its assertion only checks that an already-projected string is projected. `semantic-navigation.browser.tsx:244-307` checks BOM creation and two same-line replacements, but never applies the captured wire edits. `MonacoHost.semantic.test.tsx:34-36,67-77,179-191` mocks the wrapper and makes setValue a no-op, so its no-onChange assertion cannot demonstrate event suppression. `editor.test.ts:1256-1282` does not instantiate/assert a model or save.
- Required fixture coverage is missing for commutation across BOM 0/1/2, mixed/lone-CR EOL, astral later-line coordinates, CR/LF adjacency, cross-line multi-edits, flush/EOL-only and undo/redo. No inspected report supplies the mandatory baseline b031e6a failing-before overwrite receipt or identical real-wrapper repaired save scenario. Tester report `:111-113` explicitly excludes these/full live-TSLS/full-app acceptance.
- **Impact:** tests pass without proving the blocking prerequisite or original overwrite repair. **Confidence:** high.
- **Correction:** assert actual model-vs-wire application equality using real events and an independent sequential LSP applier; add actual pinned-wrapper reload/edit/save regression and baseline failure receipt. Keep Phase 01 incomplete until those gates and planned integration evidence exist.

### W7 — Raw rangeLength survives projection (Medium)
- **Evidence:** `MonacoHost.tsx:682-694`; `semantic-client.ts:1049-1053`; phase requirement `:35`.
- Ranges are line/UTF-16 aligned, but a range spanning CRLF has a raw model rangeLength larger than the LF wire span. The mapper still copies this deprecated value unchanged.
- **Impact:** contradictory edit metadata; server's current range application may ignore it, but the planned contract explicitly forbids this unproven metadata. **Confidence:** high.
- **Correction:** omit rangeLength in the projected event path; use the proven ranges alone.

## Suggestions

- **KISS/DRY:** keep one fenced clean-reconciliation owner. The newly duplicated store/component setValue paths make local readiness, synthetic-change suppression and semantic sync difficult to reason about.
- **Compiled-path allocation:** `server/src/semantic/uri.rs:475-477` allocates a new String even for already-LF text; consider `Cow<'_, str>` so the common unchanged pin path borrows. Preserve ownership only where the pin command requires it.
- **Documentation:** `docs/architecture/semantic-websocket-gateway.md:427` names Node 24.13.0, while `server/src/semantic/tool_profile.rs:180` pins 24.16.0. Correct the newly introduced tuple text. Intended-design labeling in both docs is appropriate; do not turn it into qualification claims yet.

## Positive observations

- Small semantic-only projection helper; generic hashes remain exact.
- Accepted revision is distinct from mtime; store decoder/save policy was not globally normalized.
- Reuses current registry, document queue and reconnect timer rather than introducing a retry framework.
- Gateway projection is applied before both pin submission and destination hash creation.
- Existing provenance/attempt isolation remains in place; no new dependencies or credentials logging introduced in the inspected changes.

## Reviewed files

All supplied modified files:
- `docs/architecture/semantic-websocket-gateway.md`
- `docs/semantic-lsp-protocol-guide.md`
- `packages/ui/src/stores/editor.ts`
- `packages/ui/src/stores/editor.test.ts`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/components/organisms/MonacoHost.semantic.test.tsx`
- `packages/ui/src/lib/semantic-model-uri.ts`
- `packages/ui/src/lib/semantic-model-uri.test.ts`
- `packages/ui/src/lib/semantic-monaco.ts`
- `packages/ui/src/api/semantic-client.ts`
- `packages/ui/src/api/semantic-client.test.ts`
- `packages/ui/src/stores/semantic-navigation.ts`
- `packages/ui/browser-tests/semantic-navigation.browser.tsx`
- `server/src/semantic/uri.rs`
- `server/src/semantic/gateway.rs`

Supporting evidence: phase plan and overview; `README.md`; relevant `docs/project-overview-pdr.md` / `docs/code-standards.md`; `EditorTabs.tsx` ownership/loading paths; pinned tuple constant; tester report.

## Validation commands/results

Source review: `git diff --stat` and scoped `git diff` commands inspected the 15-file change (+901/-31 at inspection). No tests/builds/lint run by this reviewer; did not duplicate the dedicated tester's execution.

**Tester-reported, not independently rerun** — `plans/reports/tester-261025-2249-phase01-editor-content-integrity.md:38-92`:

| Command | Observed report result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/lib/semantic-monaco.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx` | 7 files, 103 tests passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx` | 1 file, 10 Chromium tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0, TypeScript compilation |
| `cargo test --manifest-path server/Cargo.toml test_project_disk_text_for_pin` | 1 passed |
| `cargo test --manifest-path server/Cargo.toml --test semantic_websocket` | 11 passed |

No measured test/type-coverage percentage. No lint result supplied. Passing commands do not close the static defects or missing acceptance gates. Plan status intentionally unchanged under this assignment's no-task-tracking constraint; main agent owns status reconciliation.

## Unresolved questions

- No verified baseline failing-before overwrite artifact, full pinned-source/matrix proof receipt, or actual-wrapper reload/save acceptance artifact was found in the inspected Phase 01 evidence. Main agent must supply/exercise them before acceptance; these are evidence gaps, not requests for user design decisions.
- Full-app ON/OFF external reload/save, cap re-entry and live-TSLS projection/reveal evidence remains outside the tester's executed scope.
