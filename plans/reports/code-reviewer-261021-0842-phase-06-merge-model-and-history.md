# Code Review — Phase 06 Merge model and history

**Score: 4.5 / 10** — pure model solid on happy path; Phase 06 gate NOT met (history not wired, byte-fidelity + mapping-safety defects).

## Scope
- Files: see "Reviewed files". ~3.6k LOC (lib 2.6k incl. tests, hook +20, store +158, transitions +34, browser test 288).
- Focus: Phase 06 contract (`plans/261019-1505-git-conflict-resolver/phase-06-merge-model-and-history.md`) + design-contract + AC3/AC4/AC7/AC11.
- Plan file left untouched: phase still correctly "Pending"; do NOT flip todos (see Critical).
- Unrelated dirty tree noise (server/*.rs fmt, `.codegraph/.gitignore` deleted) ignored.

## Validation commands / results
| Cmd | Result |
|---|---|
| `cd packages/ui && npx tsc -p tsconfig.json --noEmit` | 0 errors |
| `npx vitest run src/lib/conflict-merge-model.test.ts src/lib/joint-history-authority.test.ts src/lib/conflict-draft-store.test.ts src/lib/conflict-draft-capacity.test.ts` | 4 files / 48 tests pass |
| `npx vitest run --config vitest.browser.config.ts browser-tests/conflict-monaco-history.browser.tsx` | 2/2 pass (real Chromium) — but see C2: tests only call `history.undo()` programmatically |
| Throwaway probe tests (deleted after run) exercising mapper/actions | reproduced C3, C4, H1–H5, M1, M2 below (values quoted) |
| Not run: full `vitest run`, e2e, lint (no lint script in `packages/ui`) |  |

## Critical issues
**C1. No production wiring of joint history authority (gate fail: "split native/application histories").**
`JointHistoryAuthority`, `saveJointHistory`, `getJointHistory` referenced only by tests/store definition (grep). Store `ignoreSide`/`markReviewed` record NO history anywhere; `acceptSide/acceptBoth/confirmWholeFileAction` go through `updateResult` → Phase 05 text-only `draft.history`; `undo/redo` (`applyDraftUndo/Redo`) restore text only, never decisions/mapping/review (`applyManualResultTextEdit` just remaps with *current* decisions). Result: two histories, metadata-only Ignore/Reviewed not undoable, undo after Accept leaves `accepted/reviewed` decision on restored text → falsely ready. Todo "Integrate single native text/metadata history authority" and AC3 are unmet.
Fix: one owner. Either drop `draft.history` for conflict drafts and route store actions through authority (atomic tx = `{beforeText,afterText,beforeDecisions,afterDecisions}`), or make draft undo/redo snapshot decisions. Add decisions snapshot to text txs too (text edit can flip reviewed→needs-review; undo must restore it).

**C2. Browser proof does not exercise native commands.** `conflict-monaco-history.browser.tsx` still titled "Phase 01", drives `model.applyEdits` + `history.undo()` directly; no keyboard Ctrl+Z, no context-menu Undo, no typing/IME, no hide/reopen/terminal-handoff. Plan step 12 + AC3 "native context-menu Undo" unproven. Test 1 uses legacy string `recordMetadataAction`, not the region-decision model.

**C3. Overlapping region mappings → destructive action on wrong text.** Probe: base `h A m B f`, ours `h S m S f`, theirs `h T1 m T2 f`, worktree `h S m B f` → `conflict-1` AND `conflict-2` both `exact` @ lines 2–2. `acceptRegionSide(conflict-2, theirs)` would overwrite region 1's line. Mapper checks uniqueness per region only; no cross-region overlap/monotonic-order validation. Violates "ambiguous mapping disables unsafe actions". Fix: after mapping, enforce strictly increasing, non-overlapping ranges; demote offenders to `ambiguous` (+needs-review).

**C4. Byte fidelity (AC7) broken for no-final-newline / BOM.**
- `previewRebuildClean` with ours `h\nours` (no EOL) → `"h\n<<<<<<< ours\nours||||||| base\nbase=======\ntheirs>>>>>>> theirs\n"` (corrupt markers). `acceptRegionBoth` ours-then-theirs → `"h\nourstheirs"`. Need to insert terminator when a token section lacks EOL before marker/concatenation (and decide/declare byte policy).
- `hasBom` computed but never applied: `applyBOM` has zero callers. Worktree BOM stripped in model; store passes `updatedModel.resultText` into `updateResult` → `draft.result` silently loses BOM after any accept. `applyManualResultTextEdit` does not strip BOM (inconsistent with `createConflictMergeModel`). Stage BOM (probe `\uFEFFh`) is embedded mid-text by whole-file/rebuild previews (`"<<<…\r\n\uFEFFh…"`).

## High (warnings)
**H1. Readiness gates on marker presence** (`computeConflictReadiness`: `isReady = … && !hasMarkers`). Probe: result with intended literal `<<<<<<< literal / ======= / >>>>>>> literal`, accepted+reviewed → `ready:false` forever. Requirement/design-contract L115: marker warnings advisory; explicit review decides. Make `hasMarkers` a warning field only; keep "region still has raw markers" only for pending/unreviewed regions.
**H2. Reviewed+ambiguous dead-end.** `isReady` requires `ambiguousRegions===0` regardless of `manualReview==="reviewed"`, yet reason is only pushed when not reviewed → `isReady=false` with empty `unresolvedReasons`, no user path out (code-read, deterministic). Count only unreviewed ambiguity.
**H3. Duplicate history entries per atomic action.** API contract = caller does `model.setValue()` THEN `recordAtomicAction()`. The `onDidChangeContent` listener (isApplying=false) pushes a `text` tx first → every atomic action = 2 undo steps (2nd is no-op setValue). Both tests (unit + browser) use this call order and only undo once, so miss it. Provide `applyAtomic(text, decisions)` that sets `isApplying` around edit and pushes one tx.
**H4. Stale authority after dispose / leaked commands.** `editor.addCommand` (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) has no disposal; `dispose()` leaves keybindings bound to the dead instance. Re-instantiating on same editor ⇒ double undo; dead instance calls `model.setValue` on retained model. Also duplicates `addAction` keybindings. Use only `addAction` (disposable) and guard `undo/redo` with `disposed`.
**H5. Whole-file preview not bound to model/draft identity.** Probe: preview built from model A (rev 1) confirmed on unrelated model B (rev 1) → B's result replaced with A's content. Store `confirmWholeFileAction(key, preview)` takes arbitrary caller preview. Bind `{draftKey/target, resultRevision, sha/len of current result}` and verify; also `resultRevision` of model vs `draft.resultRevision` are separate counters (metadata actions bump model only) — pick one.
**H6. Native undo via `model.setValue`** replaces whole doc each step: O(N), resets cursor/selection/scroll/decorations, wipes Monaco's own stack, one-keystroke granularity (maxDepth 100 keystrokes). Contradicts "native typing/multicursor/IME same logical order" quality. Prefer `pushEditOperations`/`executeEdits` with minimal diff range + selection restore, or Monaco-native undo-stop boundaries.
**H7. Memory/DoS bounds not enforced.** `DraftMemoryMetrics`/capacity ignore `mergeModel` (stage `content` + `tokens` + per-region token copies + decisions) and `jointHistory` (each tx = 2 full strings; up to 100 → ~100×N). `maxDepth` caps count only; `restoreSnapshot` doesn't re-cap. No line/region guard in `createConflictMergeModel` (probe: 20k lines/400 regions → 523 ms create, sync main thread). Add byte-based cap + count in metrics; reject/handoff over-limit explicitly (AC11).
**H8. Metadata/guard gaps in store.** `ignoreSide`/`markReviewed` do not check `isRecovery`/`isApplied`/`isResolving` (updateResult does only for text paths) → can mark stale/recovery or in-flight drafts reviewed. Phase 05 recovery rule ("no readiness") bypassed.

## Medium
- **M1. Manual edit doesn't downgrade stale decisions.** Probe: Accept ours → edit text to unrelated content → region `unmapped` yet `accepted/reviewed`, `ready:true`. Spec: remap or require review. When a previously exact-mapped, decided region becomes unmapped/ambiguous after edit ⇒ `needs-review`. Also `applyManualResultTextEdit` forces `needs-review` for ambiguous even if reviewed while mapper keeps reviewed → inconsistent policy.
- **M2. Metadata actions do a full remap.** `ignoreRegionSide`/`markRegionReviewed` retokenize result + reparse markers + O(R·L) search though text unchanged (probe 20k lines: ~55 ms each; manual-edit remap ~57 ms per keystroke, sync). Reuse `regions[].mapping` and just swap decisions; debounce/incremental remap on typing; precompute joined strings once (currently `tokens.join("")` repeated in R×M inner loops).
- **M3. Double remap + token re-tokenization.** Store `acceptSide` → `updateResult` → `applyDraftUpdate` remaps, then model overwritten with `updatedModel` (wasted). `createInitialDraft` joins server `textTokens` then `createConflictMergeModel` re-tokenizes three times (token array reuse requirement).
- **M4. "Apply nonconflicting changes" action missing** (plan step 6/todo); previews don't report whether imported/manual work would be replaced (`affectedRegions` only). Rebuild with empty base section omits `|||||||` (loses diff3 style).
- **M5. Marker parser looseness**: `startsWith("=======")`/`"<<<<<<<"` accepts any length/suffix (`<<<<<<<<<`, `=======` setext underline), no ordering validation of `|||||||` vs `=======`, last `=======` wins; `"zdiff3"` and `"partial"` styles declared but never produced (dead union members). Unmatched block silently dropped.
- **M6. Test gaps**: no tests for rebuild preview/cancel byte identity, BOM/CRLF/mixed/no-EOF round-trip through accept+undo (AC7), source-hash immutability, overlap, partial CLI edit survival (AC4), literal-marker readiness, two-block interleaved undo, over-limit handoff. Existing `ambiguous` test checks only `needs-review`. Authority unit test uses hand-rolled mock model; `getUndoCount` after atomic never asserted.

## Low / suggestions
- DRY: three `previewAcceptAll*/Rebuild` bodies near-identical; decision-map copy loop ×5; `findNext/PreviousUnresolvedRegion` duplicate filter; store try/catch ×5. Extract `withDecision(model, regionId, fn)`, `stableText(region)`, and a `{ok:false, reason}` result type instead of throw-as-control-flow with string `error`.
- `JointTransaction` dead fields (`cursorBefore/After`, `timestamp`, `description` unused); `getSnapshot` says "serializable" but may hold Monaco `Position`. Drop legacy `recordMetadataAction`/`onMetadataChange` string API once decisions-map tx is the only path (YAGNI/two APIs).
- `undo()` pops before side effects; if `onDecisionsChange`/`setValue` throws the tx is lost (neither stacks). Push to redo in `finally` on success only, restore on failure.
- Navigation: when all unresolved regions are unmapped (`resultRange=null`) next/prev always returns first element (stuck). Stable-region `oursRange/theirsRange/baseRange` all duplicate the single buffer range (misleading for non-source buffers).
- `previewAcceptAll*` on absent stage yields empty text = implicit deletion; contract says deletion is distinct action — document/guard.
- `conflict-merge-model.ts` barrel `export *` fine; `conflict-parser.ts` still exists (Phase 08 deletion per plan, OK).

## Positive
- Clear module split (types/tokenization/marker-parser/mapper/actions) under 600 LOC each; lossless tokenizer handles `\r\n`, lone `\r`, no-final-newline; absent vs empty stage descriptor kept.
- Conservative content-uniqueness mapping with fail-closed throw for ambiguous/unmapped destructive actions; Ignore keeps result text; empty string reviewable; whole-file preview/confirm with revision drift check and cancel = no-op.
- No HTML/DOM injection surface, no content in error messages/logs, region IDs only; no path handling in this phase.
- `tsc` clean; deterministic unit tests fast (48 pass).

## Recommended actions (priority)
1. C1/H3/H4/H6: one wired history authority (atomic apply API, decisions in every tx, disposable-only registrations, minimal-edit undo) and delete/retire `draft.history` text-only path for conflict drafts.
2. C3: add cross-region overlap/order validation in mapper + test.
3. C4: EOL-safe concatenation/rebuild + BOM single source of truth (strip at ingress for stages and worktree, re-apply at serialization boundary) + AC7 tests.
4. H1/H2/M1: rewrite readiness (reviewed state decides; markers advisory; ambiguous+reviewed OK; stale decisions → needs-review).
5. H5/H8: bind preview to draft identity + result digest; guard recovery/applied/resolving on all store actions.
6. H7/M2/M3: account model+history in capacity, byte cap on history, region/line cap, avoid full remap on metadata actions, reuse server tokens.
7. C2/M6: real native-command browser tests (keyboard Ctrl+Z, context menu Undo, typing, hide/reopen, metadata Ignore → Undo → Redo → branch).

## Reviewed files
`packages/ui/src/lib/conflict-merge-types.ts`, `conflict-tokenization.ts`, `conflict-marker-parser.ts`, `conflict-region-mapper.ts`, `conflict-merge-actions.ts`, `conflict-merge-model.ts`, `conflict-merge-model.test.ts`, `joint-history-authority.ts`, `joint-history-authority.test.ts`, `conflict-draft-types.ts`, `conflict-draft-transitions.ts`, `conflict-draft-store.ts`, `packages/ui/src/hooks/use-conflict-resolver.ts` (diff), `packages/ui/browser-tests/conflict-monaco-history.browser.tsx`; context: phase-06 + design-contract, `conflict-draft-capacity.ts` (grep).

## Unresolved questions
1. Do server `textTokens` include BOM in stage/worktree text, or is BOM exposed separately (needed to fix C4 at single ingress)?
2. Intended byte policy for `acceptBoth` when first side lacks trailing EOL: insert detected EOL, or preserve and flag review?
3. Is retiring Phase 05 `draft.history` in favor of the joint authority approved, or must both coexist (and who is source of truth for `resultRevision`)?
4. Measured responsiveness bound for AC11 (max lines/regions) — none found in code; what value gates handoff?
