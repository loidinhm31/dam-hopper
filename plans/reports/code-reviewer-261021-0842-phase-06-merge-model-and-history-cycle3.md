# Code Review — Phase 06 Merge model and history (Cycle 3)

**Score: 7.0 / 10** (cycle 2: 6.0, cycle 1: 4.5). Cycle-2 criticals C-A (BOM) and C-B (no-text-change accept history) **resolved + tested + re-probed**. No new critical code defects. Phase 06 **gate still NOT met** (split histories, no apply-nonconflicting, browser proof gaps) → plan stays Pending, no todos flipped, plan file untouched.

## Scope
- Files: 15 in assignment (~5.6k LOC incl. tests). Focus: C-A, C-B, W1/W2/W5/W6 carry-overs, regression hunt.
- 5 model modules + `joint-history-authority.ts` are untracked (no git diff); read in full/ranges. Store/transitions/types/hook/tests/browser test reviewed via `git diff` vs Phase 05 commit.
- Unrelated dirty tree (server/*.rs fmt, `.codegraph/.gitignore`) ignored.

## Validation commands / results
| Cmd (cwd `packages/ui`) | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | exit 0, 0 errors |
| `npx vitest run src/lib/conflict-merge-model.test.ts src/lib/joint-history-authority.test.ts src/lib/conflict-draft-store.test.ts src/lib/conflict-draft-capacity.test.ts` | 4 files / 59 tests pass (cycle 2: 55) |
| `npx vitest run --config vitest.browser.config.ts browser-tests/conflict-monaco-history.browser.tsx` | 2/2 pass, real Chromium |
| Throwaway store probe `zz-probe3.test.ts` (BOM accept/undo/redo, identical-text accept, accept-after-typing, 500× markReviewed, preview w/o draftKey) | Results below. **Deleted after run** (+ `/tmp` output). |
| Not run: full `vitest run`, e2e; no lint script in `packages/ui` | |

## Cycle-2 critical resolution
| # | Item | Status | Evidence |
|---|---|---|---|
| C-A | BOM offset desync | **RESOLVED** | Single representation: `resultText` BOM-less everywhere. `createConflictMergeModel` (actions L39-64) strips BOM from worktree + stages, maps on clean text; `confirmWholeFileAction` (L488-506) + `applyManualResultTextEdit` (L516-552) strip on ingress; `getModelSerializedResult` applies BOM only at output. Unit tests L608-712: BOM × {line-1 conflict, rebuild→accept, manual edit→accept, accept}. Store-level probe (BOM + conflict @line 2): init mapping `exact`; accept → result `"\uFEFFh\nours\nf\n"`, ready=true; undo → exact markers restored, ready=false; redo → accepted. No desync. |
| C-B | Accept w/o text change not undoable | **RESOLVED** (4 store actions) | `acceptSide/acceptBoth/confirmWholeFileAction` identical-text branch now pushes history entry w/ pre-decisions, clears coalescing, bumps revision, sets dirty (store L405-420 etc.); `ignoreSide/markReviewed` already pushed. Probe (marker-free worktree == ours): accept → `past=1`, `dirty=true`; undo → decisions `pending/none`; redo → `accepted/reviewed`. Test: store test L509-546. |
| W6 | Stale reviewed after manual edit | **RESOLVED** | `applyManualResultTextEdit` L534-541 downgrades `ambiguous` **and** `unmapped` to `needs-review/pending`. |

## Critical issues
None new. Cycle-2 criticals closed.

## Warnings (should fix before Phase 06 gate / Phase 07 wiring)
- **W-1. Phase gate: split histories (cycle-2 W3, unchanged).** Plan "Gate fails for … split native/application histories". `JointHistoryAuthority` still has zero production consumers (grep: tests + browser test only); `saveJointHistory/getJointHistory/draft.jointHistory` are dead; real history = `draft.history`. Browser proof exercises only the unwired authority via string `recordMetadataAction`. Decide owner (recommend `draft.history` + thin Monaco adapter in Phase 07; delete parallel stacks + dead store API) — don't ship both.
- **W-2. Accept after typing within 500 ms coalesces into typing entry (cycle-2 W1, half-fixed).** Probe: type, then `acceptSide` ≤500 ms later → `past` stays 1; one Undo reverts typing **and** accept. Cause: `canCoalesceHistory=false` is set *after* `updateResult()` in `acceptSide/acceptBoth/confirmWholeFileAction`; `applyDraftUpdate` sees `canCoalesceHistory=true`. Fix: set `draft.canCoalesceHistory=false` **before** calling `updateResult` (or add a `forceNewEntry`/description param to `applyDraftUpdate`). Accept→typing coalescing is fixed; reverse not. Add test.
- **W-3. Metadata history entries bypass capacity/metrics (cycle-2 W2, partial).** Depth now capped at 100 (`shift`) — unbounded growth fixed — but probe 500× `markReviewed` → `historyBytes=0`; no `checkProspectiveEditGrowth`/`calculateDraftMetrics`/`updatedAt`; up to 100 full-text copies unaccounted (AC11). Also identical-text branches same. Route via one helper that recalcs metrics.
- **W-4. `isDirty` inconsistent after redo of no-text-change accept.** Probe: accept (dirty=true) → undo (false) → redo → `isDirty=false` while decisions `accepted/reviewed`; `applyDraftRedo/Undo` recompute `isDirty` from text only. Discard w/o confirm would drop decisions. Include decision-divergence in dirty calc (or compare to initial decisions).
- **W-5. Preview binding still weak (cycle-2 W5).** `if (preview.draftKey && …)` — probe: preview w/o `draftKey` confirmed OK. `draftKey` still optional in `WholeFileActionPreview`; revision is `model.resultRevision` (2nd counter vs `draft.resultRevision`). Make `draftKey` required; bind to single revision.
- **W-6. Authority defects (cycle-2 W4, unchanged).** (a) caller order `model.setValue()` then `recordAtomicAction()` (browser test L216-223) lets content listener push a stray `text` tx → extra dead Undo step; test undoes once, misses it; make `recordAtomicAction` the only entry or document order. (b) `addCommand` ×3 not disposable, duplicate `addAction` keybindings; (c) `undo()/redo()` pop before callbacks → tx lost if callback throws; no guard after `dispose()`; (d) every undo = whole-doc `setValue` (cursor/scroll reset, O(N)).
- **W-7. Missing plan features.** "Apply nonconflicting changes" (step 6) absent (grep). No tests for AC4 cancelled-rebuild byte identity, AC7 mixed/no-EOF through accept+undo, source-hash immutability, store-level whole-file undo, AC11 over-limit handoff.
- **W-8. Browser proof gaps (plan step 12/AC3).** Keyboard `Ctrl+Z` via real input proven on unwired authority; no context-menu Undo, no typed/IME input (uses `applyEdits`), no hide/reopen retained editor against store, no terminal-handoff/refresh.
- **W-9. BOM at draft/apply boundary unaddressed.** Model strips BOM; Monaco `getValue()` also BOM-less → `draft.result` may lack BOM after typing while `getModelSerializedResult` adds it on store actions → draft.result BOM-ness flips depending on last action. Phase 07/08 must define who re-applies BOM at Apply.

## Suggestions
- DRY: 5 store actions near-identical (guard, try/catch, history push ×3 copy of identical-text block). One `commitModelAction(key, build, desc)` removes ~150 LOC and fixes W-2/W-3/W-4 once. Three `preview*` builders nearly identical; decision-map copy loop ×6.
- `applyDraftUpdate` runs `applyManualResultTextEdit` on old model then store overwrites it with accepted model (wasted remap); undo = remap twice (`applyManualResultTextEdit` + `restoreModelDecisions`). Reuse mappings for metadata-only.
- `use-conflict-resolver.ts` L775-792: new inline pass-throughs, not memoized (`useCallback`); consistent with file pattern but returns new fn identities per render.
- Dead fields: `JointTransaction.cursorBefore/After/description`, `getSnapshot` "serializable" doc vs `monaco.Position`.
- `unresolvedReasons` can be non-empty while `isReady=true` (advisory marker) — separate `warnings[]`.
- Marker parser looseness (`startsWith("<<<<<<<")`, any suffix, no ordering) — cycle-2 W9, unchanged; low risk since markers advisory.
- Large files: `conflict-merge-actions.ts` 659 LOC, `conflict-draft-store.ts` 652, test 733 — split actions (decisions / whole-file / navigation) at next touch.

## Positive
- BOM fix is the right shape (one canonical BOM-less body; BOM only at serialization) with 4 targeted tests incl. line-1 conflict.
- C-B closed at store level with decision-snapshot history; undo/redo of no-text-change accept proven.
- `unmapped`→`needs-review` downgrade closes stale-reviewed hole; all store actions guard recovery/applied/resolving; fail-closed on ambiguous mapping.
- History depth cap added; no content in error strings/logs; no HTML sinks.
- tsc clean; 59 unit + 2 browser tests green.

## Recommended actions (priority)
1. W-2: clear `canCoalesceHistory` before `updateResult` in accept/both/whole-file (+test: type→accept→single undo restores pre-accept typed text).
2. W-1: pick one history owner (draft.history + Phase 07 Monaco adapter); delete `saveJointHistory/getJointHistory/jointHistory` and either wire or remove `JointHistoryAuthority`.
3. W-3/W-4: single `commitModelAction` helper w/ metrics, capacity check, decision-aware dirty.
4. W-5: required `draftKey` + single revision.
5. W-7/W-8: implement apply-nonconflicting; add AC4/AC7/AC11 fixtures; browser tests for context-menu Undo, real typing, hide/reopen, handoff — against the store path.

## Todo/plan status
Plan `phase-06-merge-model-and-history.md` left **Pending** (no todo flipped): history integration, apply-nonconflicting, browser/handoff evidence incomplete.

## Reviewed files
`conflict-merge-types.ts`, `conflict-tokenization.ts`, `conflict-marker-parser.ts`, `conflict-region-mapper.ts`, `conflict-merge-actions.ts`, `conflict-merge-model.ts`, `conflict-merge-model.test.ts`, `joint-history-authority.ts`, `joint-history-authority.test.ts`, `conflict-draft-types.ts`, `conflict-draft-transitions.ts`, `conflict-draft-store.ts`, `conflict-draft-store.test.ts`, `hooks/use-conflict-resolver.ts` (diff), `browser-tests/conflict-monaco-history.browser.tsx`; context: cycle-2 report, phase-06 plan.

## Unresolved questions
1. History owner decision: `draft.history` (decision-aware) vs `JointHistoryAuthority`? Blocks Phase 07 wiring + gate.
2. Who re-applies BOM at Apply: store (`getModelSerializedResult`) or Apply path? Stage BOM vs worktree BOM mismatch (hasBom derived from worktree only; stage BOMs stripped) — intended?
3. Should "no-text-change accept" count as dirty after redo (decisions only)?
4. AC11 numeric bounds (lines/regions/history bytes) still undefined in code.
