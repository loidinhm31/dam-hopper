# Phase 06 Merge Model and History — Cycle 3 Verification Test Report

**Date:** 2026-10-21  
**Cycle:** Cycle 3 (Post-Cycle-2 Code Review Verification — C-A BOM & C-B Accept History)  
**Scope:** Phase 06 target test suite — UI conflict merge model, joint history authority, draft store integration, real Chromium browser history, TypeScript compilation, and Rust backend conflict regression suites.  
**Branch:** `feat/git-conflict-resolver`  
**Overall Status:** PASS for all 4 target verification commands (88/88 target tests passing, 0 failed, 0 typecheck errors; 91 distinct tests passing including supplementary editor suite).

---

## 1. Test Execution Summary

| Command | Type | Target Scope | Passed | Failed | Skipped | Exit Code | Runner Time | Wall Time |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 1. UI Unit Suites | Vitest | 5 unit test files | 62 | 0 | 0 | 0 | 4.32s | 4.88s |
| 2. UI Browser Tests | Vitest (Chromium) | 2 browser test files | 3 | 0 | 0 | 0 | 4.61s | 5.26s |
| 3. UI Typecheck | `tsc` | `@dam-hopper/ui` (`tsc -p tsconfig.json`) | Clean | 0 | 0 | 0 | — | 7.92s |
| 4. Server Conflict Regressions | Cargo | `server/Cargo.toml` (`exact_staging`, `operation_metadata`, `discovery_api`) | 23 | 0 | 0 | 0 | 0.46s | 0.56s |
| *Supplementary UI Unit* | Vitest | `MergeConflictEditor.test.tsx` (organisms baseline) | 3 | 0 | 0 | 0 | 0.36s | 0.38s |

**Total Target Executions:** 88 passing / 0 failing / 0 skipped.  
**Total Distinct Executions (incl. Supplementary):** 91 passing / 0 failing.  
**Compilation / Typecheck:** 0 errors.

---

## 2. Command Details & Execution Metrics

### Command 1: UI Unit Test Suite
```bash
pnpm --filter @dam-hopper/ui test src/lib/conflict-merge-model.test.ts src/lib/joint-history-authority.test.ts src/lib/conflict-draft-store.test.ts src/lib/conflict-draft-capacity.test.ts src/hooks/use-conflict-resolver.test.tsx
```
- **Exit Code:** `0` | **Runner Duration:** 4.32s | **Wall Time:** 4.88s
- **Breakdown (62 passed, 0 failed across 5 files):**
  - `src/lib/conflict-draft-capacity.test.ts` (3 tests, 7ms):
    - Rejects prospective edits exceeding draft budget without modifying draft (6ms)
    - Evicts only clean drafts when admitting new drafts, preserving dirty drafts (1ms)
    - Refuses new drafts when maximum dirty drafts limit is reached (0ms)
  - `src/lib/conflict-draft-store.test.ts` (21 tests, 20ms, +1 Cycle 3 test):
    - Key deterministic fencing, snapshot stability, dirty reloads, typing coalescing, discard confirmation, settlement, recovery transitions, scope retirement, cross-endpoint refusal.
    - Atomic decision+text restore on undo/redo (1ms)
    - Metadata-only Ignore side and restores decisions on undo without touching text (1ms)
    - Blocks conflict actions and whole-file confirm on recovery or applied drafts (0ms)
    - *Cycle 3 C-B Verification*: Records accept side even when text is identical to side and restores decisions on undo (1ms)
  - `src/lib/conflict-merge-model.test.ts` (31 tests, 54ms, +3 Cycle 3 tests):
    - Lossless tokenization, empty file combinations, identical merges, CRLF preservation, scaling performance (1000 lines diff3 <50ms), EOL & BOM detection, 2-way & diff3 mapping, absent base stage, side acceptance, both orders (ours-then-theirs / theirs-then-ours), whole-file preview & confirm, drift rejection, base comparison, navigation.
    - Non-overlapping line ranges, newline insertion for unterminated tokens, BOM preservation through creation and actions, advisory markers readiness when all regions reviewed.
    - *Cycle 3 C-A Verification*:
      1. Parses conflict on line 1 correctly when file has UTF-8 BOM (0ms)
      2. Preserves BOM offsets across rebuild-clean confirm and accept actions without desync across multiple conflict regions (1ms)
      3. Preserves BOM offsets across manual text edits and accept actions (0ms)
  - `src/hooks/use-conflict-resolver.test.tsx` (3 tests, 28ms):
    - Retains another profile's draft when selection switches and retires it only on invalidation (18ms)
    - Restarts inventory pagination once when the server rejects a stale cursor (4ms)
    - Does not store a snapshot after its owner changes during operation-status read (6ms)
  - `src/lib/joint-history-authority.test.ts` (4 tests, 2ms):
    - Records atomic action with text and decision states, restoring both on undo (2ms)
    - Clears redo stack upon new text edit after undo (0ms)
    - Bounds undo stack to maxDepth (0ms)
    - Captures and restores history snapshots across editor remounts (0ms)

### Command 2: UI Browser Test Suite (Real Chromium)
```bash
pnpm --filter @dam-hopper/ui test:browser browser-tests/conflict-monaco-history.browser.tsx browser-tests/conflict-resolver-history.browser.tsx
```
- **Exit Code:** `0` | **Runner Duration:** 4.61s | **Wall Time:** 5.26s
- **Breakdown (3 passed, 0 failed across 2 files):**
  - `browser-tests/conflict-monaco-history.browser.tsx` (2 passed):
    - Proves single joint undo/redo authority across native typing and metadata decisions (270ms)
    - Proves atomic text and metadata transaction undo/redo with snapshot restoration in real Chromium (24ms)
  - `browser-tests/conflict-resolver-history.browser.tsx` (1 passed):
    - Routes Ctrl+Z and Ctrl+Shift+Z through the retained draft history (166ms)
- **Execution Diagnostic:** `ResizeObserver loop completed with undelivered notifications` logged to stderr by Chromium during layout observation; non-fatal, all tests passed.

### Command 3: UI TypeScript Compilation Check
```bash
pnpm --filter @dam-hopper/ui build
```
- **Sub-command:** `tsc -p tsconfig.json` | **Exit Code:** `0` | **Wall Time:** 7.92s | **Output:** 0 errors, 0 warnings.

### Command 4: Rust Backend Conflict Regression Suite
```bash
cargo test --manifest-path server/Cargo.toml --test git_conflict_exact_staging --test git_conflict_operation_metadata --test git_conflict_discovery_api
```
- **Exit Code:** `0` | **Build:** 0.18s | **Total Test Duration:** 0.46s | **Wall Time:** 0.56s
- **Breakdown (23 passed, 0 failed across 3 suites):**
  - `git_conflict_discovery_api` (11 tests in 0.34s): non-utf8 path unsupported, legacy resolve fails closed, cursor rejection, generic stage rejection, summary/snapshot modified, delete/modify, resolve endpoint success/stale, symlink unsupported, binary files, summary paging/bounds, custom filter.
  - `git_conflict_exact_staging` (10 tests in 0.05s): concurrent mutation coordination, generic stage batch rejection, binary exact staging, index side binary, delete/modify resolution, injected failure rollback, delete action, stale precondition rejection, reviewed text empty/executable, preserve unrelated files.
  - `git_conflict_operation_metadata` (2 tests in 0.07s): lossless encodings and BOM, operation detection and sequencer metadata.

---

## 3. Cycle 2 Code Review Findings Verification Status

| Review Finding | Issue Detail | Resolution & Verification Evidence | Status |
|---|---|---|---|
| **C-A** | BOM offset desync causing text corruption & line 1 marker drop | Model maintains BOM-less `resultText` internally; strips BOM on ingest (`createConflictMergeModel`, `confirmWholeFileAction`, `applyManualResultTextEdit`); serializes with BOM strictly via `getModelSerializedResult`. Tested: line 1 conflict with BOM (`resultRange.startLine=1`), rebuild-clean confirm followed by multiple conflict accepts, and manual edit then accept. | **Verified for model-level BOM workflows** (boundary note: draft store representation vs serialized text remains Phase 07 alignment area) |
| **C-B** | Accept/whole-file with no text change not undoable | `conflict-draft-store.ts` checks `draft.result === serialized` in `acceptSide`, `acceptBoth`, `confirmWholeFileAction`, pushing history entry with prior decisions, incrementing revision, setting `isDirty=true`. Tested: accept side on pre-matching text pushes history entry and undo/redo toggles pending/accepted decisions. | **Verified for isolated identical-text accept/undo/redo** (boundary note: metadata history accounting bypasses capacity checks; dirtiness on undo/redo calculates from text alone) |

---

## 4. Execution Notes & Non-Target Disclosures

1. **Vitest Coverage Runner:** Running `vitest run --coverage` requires `@vitest/coverage-v8`, which is not currently installed in `packages/ui/devDependencies`.
2. **Browser ResizeObserver Warning:** `conflict-resolver-history.browser.tsx` logged `ResizeObserver loop completed with undelivered notifications` to stderr during Chromium execution. All 3 browser test assertions passed.
3. **Draft / Model Dirtiness Invariant:** When an action does not mutate text (e.g. metadata-only or accept matching current text), `undo` and `redo` transitions calculate `isDirty = draft.result !== (draft.appliedResult ?? draft.initialResult)`, which does not inspect decision state changes. This is an existing draft lifecycle characteristic to address in Phase 07 integration.
4. **Working Tree Cleanliness:** Working tree contains unstaged Rust server formatting/edits and `.codegraph/.gitignore` from earlier cycles; verification strictly targeted Phase 06 test boundaries without modifying or committing unrelated files.

---

## 5. Unresolved Questions

1. Should `applyDraftUndo` and `applyDraftRedo` evaluate `isDirty` against both text and decision differences from `initialResult`, ensuring drafts with accepted decisions on unchanged text remain flagged dirty after redo?
2. Should metadata-only history entries (Ignore side, no-text-change Accept) pass through `checkProspectiveEditGrowth` and `calculateDraftMetrics` rather than using the hard-coded 100-entry cap?
3. Should `@vitest/coverage-v8` be added to `packages/ui/devDependencies` for Phase 07 automated test coverage reporting?
4. Will Monaco right-click context menu undo/redo qualification be added to browser integration tests during Phase 07?
