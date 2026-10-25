# Phase 01 — Editor content integrity: Cycle 2 re-review

**Score: 6/10 — changes requested; Phase 01 not acceptance-complete.**

Static review of all 16 modified files, relevant attachment/queue/proof consumers and acceptance evidence. Published `code-review/SKILL.md` read directly. No product or plan/task-state edits; coordinator owns tracking. No tests/build/lint rerun by reviewer; dedicated tester execution attributed below.

## C1 / W1–W7 disposition

| Finding | Disposition | Evidence |
|---|---|---|
| C1 — unsafe clean reconciliation | **Partially resolved.** Fresh same-key dirty/content reads and URI check fix the prior destructive stale-content closure, but delayed attachment after a tab change can skip reconciliation entirely. | `MonacoHost.tsx:337-379,382-391,548,581-587`; `EditorTabs.tsx:764-782`; Critical C1 below. |
| W1 — retained V2 not synchronized on remount | **Partially resolved.** Ordinary ready/bound remount now queues didChange. It still sends store rather than actual materialized model text, and the initial mount callback can retain stale semantic enablement. | `MonacoHost.tsx:365-379,548`; W1/W2 below. |
| W2 — representation not end-to-end | **Unresolved.** Initial/reconciliation snapshots retain the store BOM, while replay/resync and existing-destination validation now strip a BOM from already-materialized model text. | `MonacoHost.tsx:212,370-373`; `EditorTabs.tsx:211-225`; `semantic-client.ts:890,1208,1424`. |
| W3 — older work clears rejection / in-flight query survives | **Addressed statically for notifyDidChange rejection.** Admission captures invalidation generation; rejection advances it; completion and query post-await fences check eligibility. Targeted adjacent/in-flight regressions still absent. | `semantic-client.ts:1037-1054,1100-1112,1337-1345`. |
| W4 — incorrect pending reservations | **Partially resolved.** Rejection no longer removes live reservations; unique IDs and per-document maxima fix the normal-path counterexample. Send-error fallback still drops accounting before sending its snapshot. | `semantic-client.ts:803-823,1039-1051,1106-1128`; W4 below. |
| W5 — error→close disables retry | **Addressed statically.** Error no longer retires the attempt; close retains terminal classification and schedules retryable recovery. Targeted error→close/repeated-failure regression still absent. | `semantic-client.ts:640-662,1370-1384`; test still closes directly at `semantic-client.test.ts:1622-1627`. |
| W6 — proof and F1 regression gates | **Partially resolved; acceptance remains open.** Unit/browser assertions are meaningful and mocked setValue now exercises suppression. Required real-wrapper save/baseline and complete matrix receipts remain absent. | W6 below. |
| W7 — raw projected rangeLength | **Resolved statically.** Projected host events omit rangeLength; flush/EOL-only events select full replacement. | `MonacoHost.tsx:687-705`. |

## Critical issues

### C1 — Delayed first attachment can still miss clean reconciliation after the host changes tabs

- **Evidence:** `MonacoHost.tsx:337-379,382-391,548,581-587`; `EditorTabs.tsx:764-782` renders MonacoHost without a tab key; inactive Git reloads are supported by `editor.ts:1303-1335`.
- Exact-version wrapper source stores the **initial** onMount callback in `onMountRef`, invokes it only when `isEditorReady` changes, and does not update that ref when the callback prop changes. Its value update effect depends on value, not readiness; its update hook skips work while not ready. See [wrapper 4.7.0](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/Editor/Editor.tsx) and [useUpdate](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/hooks/useUpdate/index.ts).
- **Failure trace [INFERENCE, not executed]:** host starts mounting A; before the wrapper becomes ready, selection changes to already-loaded B whose retained V1 model predates an accepted inactive reload to V2. The current parent revision effect runs before editorRef exists. The wrapper then attaches B but invokes initial callback A. The new URI fence correctly refuses A→B mutation, but nothing retries reconciliation for B: setting editorInstance does not change the reconciliation effect's dependencies. The wrapper's unchanged V2 value does not rerun merely because readiness changed. B can therefore remain editable at V1 with store/savedContent/mtime at V2; edit/save can overwrite V2.
- **Impact:** original retained-model data-loss class remains reachable even with semantics OFF. The fresh-store fix is meaningful but only fixes same-key state freshness.
- **Confidence:** high for source lifecycle/dependency gap; runtime overwrite not executed here.
- **Correction:** make delayed attachment invoke the latest attachment/reconciliation owner, e.g. stable mount handler dispatching through a current callback ref. Drive reconciliation on actual editor/model attachment plus current tab identity/revision, not only revision changes. Preserve the URI/current-clean fences and complete local reconciliation before editing. Add delayed A→B mount with retained B V1 / accepted B V2, then edit/save; also delayed same-key clean→dirty and superseded revision controls.

## Warnings

### W1/W2 — Snapshot boundaries still confuse raw store text with materialized model text (High)

- **Evidence:** `MonacoHost.tsx:199-212,357-373`; `EditorTabs.tsx:211-225`; `semantic-model-uri.ts:159-167`; `semantic-client.ts:884-890,1208,1422-1424`; caller `semantic-monaco.ts:199-213`.
- Concrete two-disk-BOM case: TextDecoder leaves one U+FEFF in the store; Monaco extracts it. Initial notifyDidOpen and reconciliation notifyDidChange still send `projectSemanticText(storeContent)`, retaining that BOM, while the actual model and server disk-pin projection have none.
- Conversely, EditorTabs.getModelText now returns **already projected model text**, or an already materialized fallback. replayMatchingModels/resyncDocument apply projectMaterializedText again. That helper is not idempotent for literal leading U+FEFF. A BOM inserted as editor data is stripped on replay/resync. validateDestination also applies it to destinationModel.getValue(), stripping real data and breaking digest/first-line coordinate equivalence.
- Exact-version [PieceTreeTextBufferBuilder](https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js) confirms metadata extraction during construction; [TextModel](https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/common/model/textModel.js) confirms getValue defaults to preserveBOM=false. This does not authorize stripping again from model content.
- Additional W1 attachment race: handleMount captures reconcileModelWithStore but omits it from dependencies (`:548`), and the wrapper retains its initial callback anyway. OFF→ON before delayed mount can leave the mount callback's semanticEnabled false. If ready replay opened retained V1 before local V2 reconciliation, notifyDidOpen is a no-op for the binding and the stale callback skips didChange. The revision effect need not rerun after attachment. **[INFERENCE]** Same latest-callback repair as C1 is needed.
- **Impact:** visible/model, wire and destination proof can disagree; legitimate navigation is rejected or uses shifted first-line coordinates. **Confidence:** high; end-to-end failure not executed here.
- **Correction:** define one getModelText contract returning projected materialized semantic text. Actual model reads and validateDestination need only P; apply materialization exactly once to genuinely raw accepted-store fallback. Initial open and reconciliation must snapshot model.getValue() when available. Keep literal editor U+FEFF and existing store/save serialization unchanged. Regress two-BOM initial open/reload and literal inserted leading BOM across replay/resync/destination proof.

### W4 — Failed-send fallback loses the bytes of its successfully resent snapshot (High)

- **Evidence:** `semantic-client.ts:1093-1128`; byte admission uses `:803-823,860-861`.
- Normal send now transfers reservation accounting into openDocumentBytes only after send. Catch deletes the reservation, then sends a full fallback, but never updates openDocumentBytes for a successful fallback.
- **Counterexample [INFERENCE, not executed]:** under document cap 1024/session cap 1500, open A=100/B=100; admit A=1000. Its first send throws once; catch removes A's reservation and successfully sends fallback A=1000. Accounting still records A=100. A following B=1000 is incorrectly admitted, allowing server-held A+B=2000. Keeping A unsynchronized blocks A navigation but does not restore aggregate accounting.
- **Impact:** F6 client admission guarantee still fails in its explicitly required failed-send path. Server rejection is defense in depth, not correct client admission. **Confidence:** high for conditional control-flow/accounting failure.
- **Correction:** retain the operation's reservation through fallback and atomically transfer it into accounted bytes on successful send; release it only on definitive failure/retirement. Prefer one existing queued full-resync path over a second unaccounted send branch. Regress send-throws-once/fallback-succeeds plus another document's growth, and fallback failure cleanup.

### W6 — Improved tests still do not discharge the mandatory acceptance gates (High)

- **Evidence:** phase plan `:35-45,63-75,155-170,232-239`; `semantic-model-uri.test.ts:406-440,442-600`; `semantic-navigation.browser.tsx:244-320`; `MonacoHost.semantic.test.tsx:34-36,67-94,195-223`; `editor.test.ts:1256-1309`; Cycle 2 tester report `:96-102`.
- Improvements are real: unit proof independently applies raw-model and projected-wire edits and compares exact equality; browser proof sequentially applies actual captured multi-edit events; host mock updates model text and deliberately fires synthetic onChange, making suppression assertion meaningful.
- Remaining evidence: required baseline b031e6a failing-before overwrite artifact; identical repaired **real pinned wrapper/client** reload→edit→save with visible V2, wire P(V2) and saved V2+edit; ON/OFF and BOM/EOL serialization controls. Store test creates no model/undo history and saves nothing; host still mocks the entire wrapper.
- Representation browser proof covers BOM construction and two same-line CRLF replacements, not full event commutation for CR/LF adjacency, flush/EOL-only, undo/redo, all BOM cases and cross-line/Unicode combinations. Unit materialization is a simulation, not installed-source qualification.
- W3/W4 tests still await changes sequentially; rejection-during-query, adjacent admitted→rejected, retained pending reservations and failed-send fallback are untested. Re-entry text is smaller than its negotiated threshold, so full sync would occur even without the unsynchronized branch. W5 still tests close-only, not error→close or repeatedly failing recovery attempts.
- Installed node_modules discovery was explicitly blocked by access policy. This review inspected exact-version published sources instead; no claim of installed-source integrity verification or a complete prerequisite receipt.
- **Correction:** retain acceptance hold. Add these discriminating regressions and required receipts; a green existing suite does not establish the original symptom or named prerequisites.

## Suggestions

1. **KISS/DRY:** retain the consolidated local reconciliation owner and existing timer/document queue. Repair the snapshot and latest-attachment boundaries directly; no new lifecycle framework, generic normalization layer or retry abstraction needed.
2. **Avoidable Rust allocation:** `project_disk_text_for_pin` immediately converts borrowed Cow to owned String (`uri.rs:458-472`), while gateway already owns disk_text (`gateway.rs:1724-1748`). The helper's LF fast path does not make the production pin path allocation-free. Borrow through hashing/proof construction or reuse the owned string when unchanged; allocate only when ownership/transformation requires it.
3. **Dead state/imports:** SocketAttempt.lastError is written but never read (`semantic-client.ts:150,640-642`). semantic-client's projectSemanticText import and editor.ts's buildLocalModelUri import are unused. Remove unused state/imports rather than retaining misleading diagnostics scaffolding.
4. **Lifecycle bookkeeping:** lastQueuedVersion retains tab keys after notifyDidClose/disconnect (`semantic-client.ts:351,1139-1163,1719-1732`). Retire entries with their binding/attempt, or put this scalar on the binding alongside invalidationGen.

## Security / performance / architecture assessment

- No new dependency, executable lookup, auth relaxation, credential persistence or content logging observed in inspected delta. Existing provenance and socket-attempt isolation remain; close classification keeps 1008/4401/4403 terminal and release/disable cancels the timer.
- Main risks remain editor integrity, semantic snapshot correctness and aggregate resource accounting, not a newly established authentication exploit. Server caps do not justify client under-accounting.
- Small semantic-only EOL projection, unchanged generic hashes, explicit accepted revision and synthetic suppression fit the architecture. Model preservation remains necessary for dirty undo. Single-owner reconciliation and queue-owned reservations are preferable to parallel state frameworks.
- Node tuple documentation now correctly says 24.16.0. Proposed-contract labeling remains honest; passing scoped tests must not turn it into an end-to-end qualification claim.

## Reviewed files

All 16 modified files:
- `docs/architecture/semantic-websocket-gateway.md`
- `docs/semantic-lsp-protocol-guide.md`
- `packages/ui/browser-tests/semantic-navigation.browser.tsx`
- `packages/ui/src/api/semantic-client.ts`
- `packages/ui/src/api/semantic-client.test.ts`
- `packages/ui/src/components/organisms/EditorTabs.tsx`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/components/organisms/MonacoHost.semantic.test.tsx`
- `packages/ui/src/lib/semantic-model-uri.ts`
- `packages/ui/src/lib/semantic-model-uri.test.ts`
- `packages/ui/src/lib/semantic-monaco.ts`
- `packages/ui/src/stores/editor.ts`
- `packages/ui/src/stores/editor.test.ts`
- `packages/ui/src/stores/semantic-navigation.ts`
- `server/src/semantic/gateway.rs`
- `server/src/semantic/uri.rs`

Supporting: Phase 01/overview plan, original and Cycle 1 reviews, Cycle 2 tester report, README, PDR, code standards, published development rules/review skill, exact-version published Monaco/wrapper sources. Approximately 1,171 changed lines (+1103/-68) plus lifecycle context.

## Validation commands / results

Reviewer executed source-inspection commands only: `git diff --stat`, `git status --short`, scoped production/test `git diff`, read/search tools and exact-version source retrieval. No verification reruns, product edits or plan/task-state edits.

**Dedicated tester-reported; not independently rerun** — `plans/reports/tester-261025-2338-phase01-editor-content-integrity-cycle2.md:40-79`:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/lib/semantic-monaco.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx` | Exit 0; 7 files, 103 passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx` | Exit 0; 10 Chromium tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript compilation |
| `cargo test --manifest-path server/Cargo.toml test_project_disk_text_for_pin` | Exit 0; 1 passed |
| `cargo test --manifest-path server/Cargo.toml --test semantic_websocket` | Exit 0; 11 passed |

125 selected tests reported passed. Test/type-coverage percentages unavailable. Lint not executed/reported. No baseline overwrite, full-app reload/save or live-TSLS fixture-matrix acceptance result supplied.

## Recommended disposition

Retain release/acceptance hold. Fix current-attachment callback handling, make raw-store/materialized snapshot contracts unambiguous, and correct fallback accounting. Then exercise discriminating asynchronous/failure tests and required real-wrapper/baseline/integration evidence. W3/W5/W7 source improvements are substantive; they do not close the complete phase.

## Unresolved questions

- Required baseline b031e6a failing-before overwrite and identical real-wrapper repaired reload/edit/save receipts remain absent from inspected evidence.
- Complete representation/event matrix and live-TSLS navigation/reveal, full-app ON/OFF save controls and above-threshold cap re-entry remain unmeasured by the supplied Cycle 2 command set.
- Installed pinned-source inspection remains blocked by configured node_modules access policy; exact-version published source was inspected instead. None of these gaps requires a new user design decision.
