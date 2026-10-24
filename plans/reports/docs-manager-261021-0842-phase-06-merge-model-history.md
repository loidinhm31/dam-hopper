# Phase 06 Documentation Management Report: Merge Model and History

**Date:** 2026-10-21  
**Author:** EvcDocsManager  
**Scope:** Phase 06 Merge Model and History documentation across System Architecture, Code Standards, Codebase Summary, and Project Roadmap.  
**File Output:** `plans/reports/docs-manager-261021-0842-phase-06-merge-model-history.md`

---

## 1. Current State Assessment

Phase 06 introduced frontend conflict merge data structures, lossless tokenization, marker parsing, 3-way region mapping, region decision actions, draft store decision-aware history, and Monaco command/context-menu undo/redo interception:
- **`ConflictMergeModel` & Tokenization:** Implemented in `packages/ui/src/lib/conflict-merge-types.ts`, `conflict-tokenization.ts`, `conflict-marker-parser.ts`, `conflict-region-mapper.ts`, `conflict-merge-actions.ts`, and re-exported via `conflict-merge-model.ts`. Separates leading UTF-8 Byte Order Mark (`\uFEFF`) at index 0 into boolean `hasBom` flag, maintaining internal `resultText` strictly BOM-free to align string indices with character offsets. Preserves raw line terminators (`\r\n`, `\n`, lone `\r`) losslessly.
- **Git Conflict Marker Parsing & Conservative Region Mapping:** Parses completed, balanced Git conflict blocks (`<<<<<<<`, optional `|||||||` diff3 separator, `=======`, `>>>>>>>`). Maps source regions computed by `node-diff3@3.2.1` (`diff3MergeRegions`) to result text via 1:1 marker count alignment (Strategy 1A), unique content matching (Strategy 1B), or resolved content searching. Downgrades ambiguous or unmapped regions to `manualReview: "needs-review"` on manual edit.
- **Draft Store Decision History Integration:** `packages/ui/src/lib/conflict-draft-store.ts` binds `mergeModel` to drafts. Records atomic history entries with `decisions` snapshots, supporting undo/redo of identical-text accept actions.
- **Joint History Authority Controller:** `packages/ui/src/lib/joint-history-authority.ts` wraps Monaco public APIs (`model.onDidChangeContent`, `editor.addCommand`, `editor.addAction`) to intercept `Ctrl+Z`, `Ctrl+Shift+Z`, and `Ctrl+Y`, and registers context-menu Undo/Redo commands.
- **Documentation Gaps Prior to This Task:**
  - `docs/system-architecture.md` only retained Phase 05 draft store notes and an early prototype reference to diff3/joint history. It omitted `ConflictMergeModel`, BOM separation rules, lossless line tokenization, balanced marker parsing, conservative region mapping strategies, readiness evaluation, draft store decision history, and concrete open defect disclosures.
  - `docs/code-standards.md` lacked normative standards for BOM-less model representation, lossless line tokenization, fail-closed conservative region mapping, and atomic decision+text history snapshots.
  - `docs/codebase-summary.md` and `docs/project-roadmap.md` listed Phase 06 as pending.

---

## 2. Changes Made

This documentation task updated 4 documentation files in `docs/` and generated 1 compaction artifact:

### A. System Architecture (`docs/system-architecture.md`)
- Updated section heading to `### Git Conflict Resolver Architecture (Phase 06 Merge Model & Draft History Implementation Added; Qualification Gates Open)`.
- Reconciled narrative: noted that Phase 06 adds client merge model, lossless tokenization, conservative diff3 mapping, decision actions, and draft history implementation, while Phase 01 native-history/Monaco byte-fidelity qualification gates and downstream Monaco surface wiring remain open.
- Added comprehensive documentation for Phase 06 architecture:
  - **Canonical BOM-less Model Representation:** Detailed separation of one leading UTF-8 BOM (`\uFEFF`) at index 0 into `hasBom` flag on ingest (`createConflictMergeModel`, `applyManualResultTextEdit`, `confirmWholeFileAction`), keeping internal `resultText` strictly BOM-free without altering arbitrary `U+FEFF` characters elsewhere. Documented serialization via `getModelSerializedResult(model)`.
  - **Lossless Line Tokenization (`conflict-tokenization.ts`):** Documented raw terminator preservation (`\r\n`, `\n`, lone `\r`) and missing final newline roundtrip fidelity (`rejoinLosslessLines(tokens) === text`). Line ending classification (`detectLineEnding`) detects dominant `crlf`, `lf`, `mixed`, or `none`.
  - **Git Conflict Marker Parser (`conflict-marker-parser.ts`):** Documented balanced marker block parsing (`<<<<<<<`, optional `|||||||`, `=======`, `>>>>>>>`), stage token extraction, line spans, and offsets. Noted requirement for completed balanced blocks (unterminated markers treated as plain text).
  - **Conservative 3-Way Region Mapping (`conflict-region-mapper.ts`):** Documented source region construction using `node-diff3@3.2.1` (`diff3MergeRegions`). Preserved diff3 execution budget caveat ($\le$ 5,000 lines or $\le$ 500 KB) and unqualified complexity bounds. Documented Strategy 1A (count/token alignment), Strategy 1B (unique token matching with non-overlapping range assertion), content searching with fail-closed ambiguity flagging (`confidence: "ambiguous"`), and manual edit review downgrade (`applyManualResultTextEdit` downgrades ambiguous/unmapped to `needs-review`).
  - **Readiness Evaluation (`computeConflictReadiness`):** Documented conflict counts aggregation and readiness criteria (unresolved = 0, ambiguous = 0, all regions `manualReview === "reviewed"`). Noted edge cases where unparsed malformed markers or empty conflict sets can vacuously satisfy review criteria.
  - **Draft Store Decision History & Model Actions:** Documented actions (`acceptRegionSide`, `ignoreRegionSide`, `acceptRegionBoth`, `markRegionReviewed`, whole-file previews, and `confirmWholeFileAction`). Detailed atomic decision-aware history snapshots and identical-text accept undo/redo.
  - **Open Correctness Defects & Boundary Realities:** Explicitly documented known defects:
    1. *Metadata history capacity bypass:* Metadata-only store actions push full text into history under fixed 100-entry cap without passing `checkProspectiveEditGrowth` or incrementing `historyBytes`.
    2. *Redo dirtiness evaluation:* Redo of an identical-text accept evaluates `isDirty` strictly against initial text, so decision-only changes do not register as dirty after redo and risk clean eviction or missed recovery.
    3. *Typing coalescing sequence:* In text-changing store actions, `draft.canCoalesceHistory = false` is assigned after `updateResult`, so preceding typing within 1000ms may coalesce unless explicitly interrupted.
    4. *BOM re-application boundary:* Store actions serialize via `getModelSerializedResult`, while manual Monaco edits return un-BOM'd strings from `getValue()`; single authority for BOM re-attachment prior to backend staging remains a downstream integration gate.
  - **Joint History Authority Controller (`JointHistoryAuthority`):** Documented standalone Monaco controller wrapping `model.onDidChangeContent`, `editor.addCommand`, and `editor.addAction` for `Ctrl+Z`, `Ctrl+Shift+Z`, and `Ctrl+Y`. Detailed atomic transactions (`JointTransaction`), `maxDepth` bounding, branch-clears-redo, and snapshot remount restoration (`getSnapshot` / `restoreSnapshot`). Documented that `JointHistoryAuthority` operates separately from `draft.history` and is not yet unified or wired to `MergeConflictEditor`.

### B. Code Standards (`docs/code-standards.md`)
- Added durable normative standards under `### Git conflict discovery, snapshots, and client mutations`:
  - **Canonical BOM-less Model Representation:** Separation of one leading UTF-8 BOM (`\uFEFF`) at index 0 into `hasBom` flag on ingest; BOM re-application only at final serialization (`getModelSerializedResult`).
  - **Lossless Line Tokenization:** Strict preservation of raw terminators (`\r\n`, `\n`, lone `\r`) and missing final newlines with 100% roundtrip fidelity.
  - **Conservative Region Mapping & Downgrade Rules:** Fail-closed region mapping prioritizing parsed Git conflict markers; multiple matches must flag `confidence: "ambiguous"`; unmatched regions must flag `confidence: "unmapped"`; manual text edits must downgrade ambiguous/unmapped regions to `manualReview: "needs-review"`.
  - **Atomic History Transactions & Decision Snapshots:** History entries must capture atomic snapshots of both text and region decision states; identical-text decisions must record history entries to allow deterministic undo/redo.
  - **Normative Invariants vs Open Implementation Defects:** Enforced that normative standards require byte accounting across all history growth and strict dirtiness tracking; current component defects (metadata history byte capacity bypass, typing coalescing ordering, decision-only redo dirtiness evaluation, split history stacks) must be tracked as open safety defects rather than permitted architectural exceptions.

### C. Codebase Summary (`docs/codebase-summary.md`)
- Synchronized line 83: Recorded Phase 06 merge model and draft history implementation added, while downstream integration and qualification gates remain open (history authority unification, floating Monaco surface in Phase 07, workspace integration in Phase 08, and Phase 01 native-history and Monaco byte-fidelity qualification).
- Updated line 97: Re-generated repomix compaction artifact (`repomix-output.xml`) via `repomix --style xml -o repomix-output.xml` (3,048 files, 7,535,322 tokens; identified as filtered packaging statistics, not full repository coverage).

### D. Project Roadmap (`docs/project-roadmap.md`)
- Synchronized line 11: Updated Git conflict resolver status to `**In progress (Phases 01–05 complete; Phase 06 merge-model and draft-history implementation added; integration/qualification gates remain; unreleasable coordinated migration).**`
- Documented outstanding gates: history authority unification (reconciling `JointHistoryAuthority` and `draft.history`), open correctness gates (metadata history byte accounting, redo dirtiness evaluation, typing coalescing sequence), floating Monaco surface wiring (Phase 07), workspace integration and cutover (Phase 08), and open Phase 01 native-history and Monaco byte-fidelity qualification.
- Updated document timestamp to 2026-10-21.

---

## 3. Metrics & File Line Counts

All documentation files remain strictly within the `docs.maxLoc` ceiling (< 800 LOC):

| File | Type | Lines of Code | Status vs 800 LOC Limit | Headroom |
|---|---|---:|---|---:|
| `docs/system-architecture.md` | Modified | 390 | OK | 410 lines |
| `docs/code-standards.md` | Modified | 120 | OK | 680 lines |
| `docs/codebase-summary.md` | Modified | 97 | OK | 703 lines |
| `docs/project-roadmap.md` | Modified | 44 | OK | 756 lines |

---

## 4. Verification and Validation Evidence

1. **Documentation Link & Consistency Validation:**
   - Command: `node .omp/evcrate/scripts/validate-docs.cjs docs/`.
   - Result: 70 markdown documents scanned. Check 1 (Internal links): 100% valid; 0 broken links. Baseline pre-existing unverified environment key warnings preserved; zero new broken links or errors introduced.
2. **Codebase Cross-Referencing:**
   - Inspected `ConflictMergeModel`, `ConflictMergeRegion`, `RegionDecisionState`, `WholeFileActionPreview` in `packages/ui/src/lib/conflict-merge-types.ts:1-110`.
   - Inspected `tokenizeLosslessLines`, `rejoinLosslessLines`, `detectLineEnding`, `detectBOM`, `stripBOM`, `applyBOM` in `packages/ui/src/lib/conflict-tokenization.ts:1-86`.
   - Inspected `parseResultMarkerBlocks` in `packages/ui/src/lib/conflict-marker-parser.ts:1-92`.
   - Inspected `buildSourceRegions`, `mapRegionsToResultText`, `computeConflictReadiness` in `packages/ui/src/lib/conflict-region-mapper.ts:1-432`.
   - Inspected `createConflictMergeModel`, `acceptRegionSide`, `ignoreRegionSide`, `acceptRegionBoth`, `markRegionReviewed`, `confirmWholeFileAction`, `applyManualResultTextEdit`, `getModelSerializedResult` in `packages/ui/src/lib/conflict-merge-actions.ts:1-659`.
   - Inspected `JointHistoryAuthority`, `JointTransaction`, `JointHistorySnapshot` in `packages/ui/src/lib/joint-history-authority.ts:1-262`.
   - Inspected draft store actions and history handling in `packages/ui/src/lib/conflict-draft-store.ts:388-650` and `conflict-draft-transitions.ts:1-230`.
   - Inspected hook exposure in `packages/ui/src/hooks/use-conflict-resolver.ts:770-795`.
3. **Target Test & Review Reports Cited:**
   - Tester Report `plans/reports/tester-261021-0842-phase-06-merge-model-and-history.md`: Cycle 3 verified 88/88 target tests passing (62 UI unit tests across 5 files, 3 Chromium browser tests across 2 files, UI `tsc` build exit 0 with 0 errors, 23 Rust backend conflict regression tests exit 0).
   - Code Reviewer Report `plans/reports/code-reviewer-261021-0842-phase-06-merge-model-and-history-cycle3.md`: Cycle 3 score 7.0/10, verifying C-A (BOM) and C-B (no-text-change accept history) resolved, with W1–W9 recorded as open integration and correctness gates.
4. **Advisor Consultation:**
   - Consulted on initial draft and completion draft via `xd://ask_advisor`.
   - Incorporated all recommendations: refused premature "complete" claims, separated the two history mechanisms (`JointHistoryAuthority` vs `draft.history`), explicitly designated metadata history capacity bypass and redo dirtiness as open correctness defects, restored diff3 resource limit caveats, tightened BOM separation to leading character only, and distinguished balanced marker blocks from raw marker readiness detection.

---

## 5. Unresolved Questions

1. Will Phase 07 unify `JointHistoryAuthority` directly into `ConflictDraftRegistry` (via a thin Monaco adapter), or will `JointHistoryAuthority` wrap the draft store as its single backing source of truth?
2. Should `draft.history` metadata entries (Ignore side, no-text-change Accept) be routed through `checkProspectiveEditGrowth` and update `historyBytes` in Phase 07, or will a unified history structure enforce a separate byte-accounting policy?
3. Should `applyDraftRedo` evaluate `isDirty` against both text and decision divergence from `initialResult`, ensuring drafts with accepted decisions on unchanged text remain flagged dirty after redo?
4. Who has authoritative responsibility for re-applying the UTF-8 Byte Order Mark prior to backend staging: the store serialization layer (`getModelSerializedResult`), or the resolution submission dispatch handler?