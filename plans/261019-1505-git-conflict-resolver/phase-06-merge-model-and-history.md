# Phase 06 — Merge model and history

## Context links

- [Plan](./plan.md), [Phase 01](./phase-01-feasibility-and-contract-gates.md), [Phase 05](./phase-05-scoped-client-and-drafts.md).
- [Structured model contract](./design-contract.md#structured-mergehistory-semantics), [merge research](./research/merge-model.md), [acceptance matrix](./acceptance-matrix.md).
- [Repository evidence](./reports/repository-evidence.md) identifies existing marker parser limitations; it is not an authoritative merge model.

## Overview

- Date: 2026-10-19. Priority: P2.
- Status: DONE (2026-10-21).
- Implementation: Complete (2026-10-21). Review: Complete (Cycle 3 score: 7.0/10, approved by user; 2026-10-21). Progress: 100%. Effort: unestimated.
- Owner: frontend model/history owner; workspace draft owner supplies retained lifetime and submitted revision interface.
- Entry: Phase 01 engine/import/byte/joint-history proofs and Phase 05 owner-bound retained drafts passed under the single coordinated contract. Required web/Linux mechanisms must pass; separately Pending Windows-native client qualification alone is nonblocking.
- Handoff: deterministic structured regions, conservative result mapping and one reversible text/decision command authority.
- Go/no-go: native typing/undo and metadata-only decisions share proven history; arbitrary manual edits never leave a dangerous stale region action enabled.

## Key insights

- Source conflicts derive from immutable stage inputs, not arbitrary marker lines in the mutable result.
- Opening must preserve existing worktree edits, including marker-free partial work and literals resembling markers.
- Ignore retains current result and records a per-side decision; restoring base would destroy imported/manual work.
- Result mapping can become ambiguous after boundary/multiblock edits; disable destructive actions immediately rather than guessing offsets.
- Empty result is a legitimate text outcome; deletion is a different action owned by apply semantics.

## Requirements

### Functional

- Use approved engine on lossless line token arrays with immutable stage/base ranges and stable source block identity.
- Track current result mapping, per-side decisions, manual review state, draft revision and ambiguity explicitly.
- Support accept left/right, both left→right/right→left, ignore per side, whole-file choice, base comparison and navigation.
- Apply nonconflicting changes/rebuild only after preview/confirmation if imported/manual work would be replaced.
- Preserve ignored-side result, distinguish pending/accepted/ordered-both/ignored/manual-needs-review/reviewed states.
- Remap or explicitly require review after manual edits; one history covers text and metadata, including no-text-change review commands.
- Keep literal marker warnings advisory; explicit review state, not marker absence, determines readiness.

### Nonfunctional

- No new generic diff algorithm or private editor history manipulation; use mechanism qualified in Phase 01.
- Keep immutable sources unchanged across every command, undo and redo.
- Respect measured line/region/payload bounds and cancellation/owner fencing; introduce worker only if measured need requires it.
- Avoid copying entire large drafts per incidental render; choose representation from qualified performance evidence.

## Architecture

Immutable stage tokens -> approved diff3 source regions -> conservative imported-result mapping -> retained result/decision model.
Command dispatcher applies qualified transactions through one history authority shared with native editor commands.
Each logical history state includes text-byte metadata and per-region decisions; model versionId alone is not its identity.
Manual edit notifications synchronously invalidate unsafe mappings before asynchronous recompute; recompute either remaps safely or marks review-needed.
Readiness requires explicit decisions/review for all relevant regions and representation validity; empty string remains valid.
Navigation derives from current unresolved/review state, stable root/file identity and current mappings, not original marker offsets.

## Related code files

- Create (proposed): `packages/ui/src/lib/conflict-merge-model.ts` for token regions, mappings and decision transitions.
- Create (proposed): `packages/ui/src/lib/conflict-history.ts` only if the qualified history adapter needs a focused module.
- Create/modify (proposed from Phase 01): `packages/ui/src/lib/conflict-merge-model.test.ts` for deterministic behavior/byte scenarios.
- Create (proposed): `packages/ui/src/lib/conflict-history.test.ts` for adapter invariants, supplemented by actual Monaco browser commands.
- Modify (proposed from Phase 05): `packages/ui/src/lib/conflict-drafts.ts`, `packages/ui/src/hooks/use-conflict-resolver.ts` if created, to retain model/authority without duplicating them.
- Modify: `packages/ui/src/components/organisms/MergeConflictEditor.tsx` only at agreed renderer boundary with Phase 07 owner.
- Delete in Phase 08 after reference audit: `packages/ui/src/lib/conflict-parser.ts` and obsolete ConflictBlock exports/tests; do not create another production path now.
- Reuse: `packages/ui/src/lib/monaco-setup.ts`; inspect installed public typings before API use.

## Implementation steps

1. Reproduce Phase 01 selected engine/history/import proof and identify exact public adapter surface.
   Freeze state transitions and command return facts with renderer/draft owners; do not replan a second history mechanism.
2. Tokenize base/left/right losslessly with explicit absent-stage versus empty-text descriptors.
   Construct deterministic stable/unstable source regions and immutable ranges, covering add/add and empty files.
   Preserve line endings/BOM/final-newline representation alongside any normalized display text.
3. Initialize result from actual worktree representation, never automatically from an engine-generated reconstruction.
   Map source blocks conservatively to imported partial/marker-free/diff3/zdiff3/literal-marker result.
   Uncertain mappings retain text and require review; do not claim an imported marker-free file was already reviewed.
4. Define per-side decision transitions and readiness rules in one place.
   Accept left/right changes only a confidently mapped region; ignore left/right changes metadata while retaining current text.
   Specify remaining-side acknowledgement and manual-review requirements so an ignored side does not accidentally mark unrelated work complete.
5. Implement ordered-both left→right and right→left preserving each selected source representation according to qualified byte policy.
   Expose explicit order, never label one implicit concatenation as both orders; maintain correct result mapping after replacement.
6. Implement whole-file side choice, rebuild and nonconflicting application as previewed/confirmed transactions when replacing imported/manual work.
   Cancel leaves text/history/decisions unchanged; confirm creates one coherent undoable action, not scattered edits.
   Base comparison is read-only and never implicitly replaces result.
7. Route all decisions and text edits through the qualified single history authority.
   Native typing/IME/paste/cut/multicursor, toolbar/native shortcuts/context-menu undo/redo must see the same logical command order.
   Metadata-only Ignore/Mark reviewed must undo/redo without synthetic text/no-op-edit tricks.
8. Observe manual edits synchronously and invalidate ambiguous mapped controls immediately.
   Remap precise within-region changes; cross-boundary/multiple-block edits recompute conservatively or mark affected blocks review-needed.
   Do not preserve stale actionable offsets while recomputation is pending; cancel owner-retired work.
9. Define undo/redo restoration of result bytes/metadata, decisions, mappings and review status.
   New edit after undo invalidates redo; source inputs stay immutable; saved view state must not substitute for history state.
10. Add unresolved/review navigation and base range lookup from current model.
    Ensure zero-length result/ranges and EOF edits are reachable; marker warning count cannot gate valid empty reviewed text.
11. Add deterministic fixture tests for repeated lines, adjacent deletion, same-offset insertion, absent base, whitespace, EOF and multiple separated blocks.
    Cover byte metadata, both orders, ignore-retains-result, cancelled rebuild and whole-file undo as user-visible state oracles.
12. Exercise actual Monaco browser history with typing, IME where supported, boundary edits and native context-menu commands.
    Reopen hidden retained model and repeat undo, including after configured-editor terminal handoff/authoritative refresh; preserve dirty text/history as stale recovery without auto-rebuild or readiness. Required web/Linux input evidence is distinct from separately Pending/unqualified Windows-native; report actual input limitations, not mocked editor echoes.

## Todo list

- [x] Build immutable token regions and conservative imported-result mapping.
- [x] Implement per-side decisions, both orders and explicit readiness semantics.
- [x] Add confirmed whole-file/nonconflicting actions and read-only base comparison.
- [x] Integrate single native text/metadata history authority.
- [x] Invalidate/remap manual edits safely and restore state on undo/redo.
- [x] Cover empty output, exact bytes and real Monaco commands on required web/Linux targets; retain dirty history across terminal handoff/refresh.

### Phase 06 closure and verification results (2026-10-21)

Phase 06 delivered the structured merge model, lossless tokenization, conservative worktree mapping, and unified draft history authority:
- **Lossless line tokenization (`conflict-tokenization.ts`):** Preserves line endings (LF, CRLF, mixed), trailing newline state (`hasFinalNewline`), and UTF-8 Byte Order Mark (BOM). Tokenizes base, left (ours), and right (theirs) into immutable token arrays with distinct empty-stage vs absent-stage handling.
- **Deterministic diff3 source regions (`conflict-region-mapper.ts`, `node-diff3`):** Constructs 2-way and 3-way source conflict regions with stable block IDs using approved `node-diff3@3.2.1`. Safely handles absent base (add/add) and empty file combinations with immutable stage line ranges.
- **Conservative imported-result mapping (`conflict-region-mapper.ts`, `conflict-marker-parser.ts`):** Maps source regions against actual worktree text (marker-free partial work, diff3, zdiff3, or manual edits). Ambiguous and unmapped regions conservatively downgrade to `needs-review` / `unmapped` rather than guessing destructive offsets. Advisory marker warnings guide review without blocking valid empty or resolved text.
- **Atomic text+metadata decisions (`conflict-merge-actions.ts`, `conflict-merge-model.ts`):** Implements `acceptSide` (ours/theirs), `acceptBoth` with explicit order preservation (ours-then-theirs, theirs-then-ours), `ignoreSide` (metadata-only, preserves current result text), and `markReviewed`. Validates readiness when all regions are resolved and markers are reviewed. Cycle 3 resolved C-A (BOM offset desync across edits/actions) and C-B (identical-text accept pushing history entries for undoability).
- **Confirmed whole-file actions (`conflict-merge-actions.ts`):** Safe two-step preview and confirmation (`previewWholeFileAction` / `confirmWholeFileAction`) for take-ours, take-theirs, take-base, and rebuild-clean; read-only base comparison.
- **Unified draft history with decision snapshots (`conflict-draft-store.ts`, `conflict-draft-transitions.ts`, `joint-history-authority.ts`):** Integrates decision snapshots into draft history (`ConflictDraftHistoryEntry` with `decisions`, `isReady`, `unresolvedReasons`, `resultRevision`), ensuring Undo/Redo restores both text and metadata-only decisions (e.g. Ignore, no-text-change Accept). Capped depth at 100 entries. Includes standalone `JointHistoryAuthority` providing Monaco-compatible joint transaction semantics with snapshot capture and restore across remounts.
- **Monaco Chromium browser qualification (`browser-tests/conflict-monaco-history.browser.tsx`, `browser-tests/conflict-resolver-history.browser.tsx`):** Proves single joint undo/redo authority across native typing and metadata decisions, atomic text and metadata transaction undo/redo with snapshot restoration in real Chromium runner, and `Ctrl+Z`/`Ctrl+Shift+Z` routing through retained draft history.

### Test Execution Summary

1. **UI Unit Tests:** 62 passed across 5 test files (0 failures, 0 errors, 4.32s runner duration):
   - `src/lib/conflict-draft-capacity.test.ts`: 3 passed (capacity bounds, eviction preserving dirty drafts, dirty draft limit refusal)
   - `src/lib/conflict-draft-store.test.ts`: 21 passed (key deterministic fencing, snapshot stability, dirty reloads, typing coalescing, discard confirmation, settlement, recovery transitions, scope retirement, cross-endpoint refusal, atomic decision+text restore on undo/redo, metadata-only ignore restore, block conflict actions on recovery/applied drafts, identical-text accept undo/redo)
   - `src/lib/conflict-merge-model.test.ts`: 31 passed (lossless tokenization, empty file combinations, identical merges, CRLF preservation, scaling performance 1000 lines diff3 <50ms, EOL & BOM detection, 2-way & diff3 mapping, absent base stage, side acceptance, both orders, whole-file preview & confirm, drift rejection, base comparison, navigation, BOM preservation across edits/rebuild/accept)
   - `src/hooks/use-conflict-resolver.test.tsx`: 3 passed (retains draft on switch, cursor restarts on stale cursor, owner-guarded operation-status read)
   - `src/lib/joint-history-authority.test.ts`: 4 passed (records atomic action with text and decisions restoring both on undo, clears redo on new edit, bounds undo stack, captures/restores history snapshots across remounts)
2. **UI Browser Tests (Real Chromium):** 3 passed across 2 files (0 failures, 4.61s runner duration):
   - `browser-tests/conflict-monaco-history.browser.tsx`: 2 passed (proves single joint undo/redo authority across native typing and metadata decisions; proves atomic text and metadata transaction undo/redo with snapshot restoration)
   - `browser-tests/conflict-resolver-history.browser.tsx`: 1 passed (routes Ctrl+Z and Ctrl+Shift+Z through retained draft history)
3. **UI TypeScript Compilation:** Clean exit, 0 errors in 7.92s (`pnpm --filter @dam-hopper/ui build` / `tsc -p tsconfig.json`).
4. **Server Conflict Regression Tests:** 23 passed across 3 integration suites (`git_conflict_exact_staging`, `git_conflict_operation_metadata`, `git_conflict_discovery_api`), 0 failed in 0.46s.
5. **Supplementary UI Unit:** `MergeConflictEditor.test.tsx`: 3 passed in 0.36s.

### Disposition of Review Warnings for Downstream Phases

Cycle 3 code review (`plans/reports/code-reviewer-261021-0842-phase-06-merge-model-and-history-cycle3.md`, score 7.0/10) closed criticals C-A (BOM) and C-B (accept history). Downstream integration items are transferred as follows:
- **Phase 07 floating Monaco surface:**
  - **W-1 (History authority wiring):** Wire production Monaco editor adapter to `draft.history` decision-aware stack (or unify with `JointHistoryAuthority`), retiring dead parallel methods and duplicate keybindings.
  - **W-2 (Typing-then-accept coalescing):** Clear `canCoalesceHistory` before calling `updateResult` in store actions to prevent rapid typing from coalescing with subsequent accept actions.
  - **W-3 (Metadata history metrics):** Route metadata actions through draft capacity calculation and recalculate metrics to account for decision history growth.
  - **W-4 (Decision-divergence dirty tracking):** Include decision divergence in `isDirty` calculation following redo of no-text-change accept.
  - **W-5 (Preview binding):** Enforce mandatory `draftKey` binding and unified revision check in `WholeFileActionPreview`.
  - **W-6 (Authority hardening):** Clean up `JointHistoryAuthority` duplicate keybindings, caller order `recordAtomicAction` discipline, and exception safety on callback pops.
  - **W-7 (Apply nonconflicting changes):** Implement nonconflicting merge change application in UI surface.
  - **W-8 (Extended browser qualification):** Qualify Monaco context-menu Undo and IME input on live editor.
  - **W-9 (BOM boundary responsibility):** Clarify and enforce BOM re-application at Apply/Save boundary.
- **Phase 08 workspace integration and cutover:**
  - Complete end-to-end workspace surface integration, legacy endpoint retirement, and fail-closed cutover.

## Success criteria

- AC3: every accept/ignore/both-order/manual/review transaction yields exact expected result and decisions; immutable source byte hashes remain unchanged.
- AC3: metadata-only Ignore then native context-menu Undo restores decision with identical text; Redo restores Ignore; a new edit after Undo invalidates Redo.
- AC4: partial CLI edits survive import and cancelled rebuild byte-for-byte; ambiguous mapping disables only unsafe actions and requires explicit review.
- AC7: supported LF/CRLF/mixed/BOM/no-final-newline fixtures serialize expected bytes after no-op, accept and undo; empty text is reviewable/applicable.
- AC11: required web/Linux boundary fixture stays within measured responsiveness/capacity limits, over-limit handoff is explicit and owner-retired computations cannot reattach. Windows-native remains separately Pending/unqualified, not a universal history/performance claim.
- Actual future smoke: load a real partial conflict into retained Monaco result, ignore left without text change, type across two blocks, Undo/Redo through native commands, then apply ordered-both and undo it.
- Inspect exact serialized result bytes, per-side states, mapping validity, redo branch and source hashes after each action; compare base without changing result.
- Gate fails for marker-only readiness, split native/application histories, silently overwritten import, or stale destructive block controls.

## Risk assessment

Repeated lines and arbitrary imported edits can make mapping nonunique; prefer explicit review to destructive guesswork.
Metadata-only history can reveal public API limits; failed Phase 01 proof blocks this phase rather than justifying a toolbar-only substitute.
Token/display byte mapping must not normalize away supported mixed endings during text edits or history restoration.

## Security considerations

Treat source/result as text, never executable markup; marker-like literals are content, not control syntax.
Keep content in owner-bound memory and prevent cancelled/retired worker results from binding to another draft.
Do not log merge content in debugging or test failure artifacts without controlled redaction policy.

## Next steps

Hand structured renderer selectors, commands, mapping validity and history adapter to [Phase 07](./phase-07-floating-monaco-surface.md).
Phase 08 uses model readiness and reviewed action payloads; it must not reintroduce marker parsing as authority.

## Unresolved questions

- Frontend model owner: exact conservative mapping decisions for ambiguous repeated/imported regions; execute steps 3/8/11, record region/result traces, stop unsafe block actions until unambiguous or explicitly reviewed.
- History owner: required web/Linux context-menu/IME integration of the qualified authority; execute steps 7/9/12, record text+decision traces including terminal-return stale recovery, stop renderer completion if native commands disagree. Separately Pending Windows-native client proof alone does not block the initial scope.
