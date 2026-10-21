# Code Review — Phase 06 Merge model and history (Cycle 2)

**Score: 6.0 / 10** (cycle 1: 4.5). Cycle-1 criticals mostly fixed at model/store level; new silent-corruption path (BOM offsets) + undo hole remain. Phase 06 gate NOT yet met → plan stays Pending, no todos flipped.

## Scope
- Files: 15 in assignment (~5.1k LOC incl. tests). Focus: cycle-1 C1–C4/H1/H2/H8 resolution + regression hunt.
- Plan file untouched (`phase-06-merge-model-and-history.md` remains Pending).
- Unrelated dirty tree (server/*.rs fmt, `.codegraph/.gitignore`) ignored.

## Validation commands / results
| Cmd (cwd `packages/ui`) | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | exit 0, 0 errors |
| `npx vitest run src/lib/conflict-merge-model.test.ts src/lib/joint-history-authority.test.ts src/lib/conflict-draft-store.test.ts src/lib/conflict-draft-capacity.test.ts` | 4 files / 55 tests pass (was 48) |
| `npx vitest run --config vitest.browser.config.ts browser-tests/conflict-monaco-history.browser.tsx` | 2/2 pass, real Chromium |
| Throwaway probes `zz-probe*.test.ts` (mapper/actions/store; results via file output) | Reproduced C-A, C-B, W1, W2, W4 below. **Deleted after run.** |
| Not run: full `vitest run`, e2e; no lint script in `packages/ui` | |

## Cycle-1 critical resolution
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Joint history wiring: decisions tracked/restored on undo/redo | **Partial** | Store now pushes `DraftHistoryEntry{text,decisions}` (`conflict-draft-transitions.ts` L146/172-194/201-224; `ignoreSide`/`markReviewed` push entries). Undo-after-Accept restores decisions (store test L15-64). Holes: C-B below, W1, W2. `JointHistoryAuthority` still has zero production consumers (grep: only tests + dead `saveJointHistory/getJointHistory/draft.jointHistory`). |
| 2 | Native `{Control>}z` in Chromium | **Resolved for keyboard** (test 1 L99-135 uses `userEvent.keyboard`), but only on the unwired authority; no context-menu Undo, no real typing/IME, no hide/reopen retained-model, no terminal-handoff. Plan step 12 / AC3 context-menu still unproven. |
| 3 | Non-overlapping mapping (`claimedRanges`) | **Resolved** | mapper L138/221-246/295-304; probe: 2nd region → `ambiguous`; test L557. Reordered-but-disjoint regions still map exact (non-monotonic) — acceptable. |
| 4 | LF/CRLF/BOM preservation | **EOL resolved; BOM NOT** | EOL separator insertion in rebuild/both OK (test L585). BOM: see C-A. |
| 5 | Advisory markers readiness | **Resolved** | `isReady` no longer blocked when all regions reviewed (mapper L417-420; test L629). H2 (reviewed+ambiguous dead-end) also fixed (L377-384). Nit: `unresolvedReasons` still lists marker message while `isReady=true` (probe). |
| 6 | Action guards recovery/applied/resolving | **Resolved** | all 5 store actions guard (`acceptSide/ignoreSide/acceptBoth/markReviewed/confirmWholeFileAction`); test L108-128. |

## Critical issues
**C-A. BOM offset desync → silent text corruption + false-ready (AC7).** Model stores `resultText` WITH BOM but maps on mixed strings:
- `confirmWholeFileAction` (`conflict-merge-actions.ts` L490-503) maps on BOM-less `previewText`, stores `applyBOM(previewText)` → all `resultOffset` off by +1. Probe (BOM worktree, 2 conflicts → rebuild-clean confirm → `acceptRegionSide(conflict-1)`) → `"\uFEFFhours1\n\nm\n<<<…"` (lost `\n`, wrong slice replaced).
- `applyManualResultTextEdit` (L512-547): Monaco `getValue()` strips BOM, mapping on BOM-less text, stored with BOM → same off-by-one. Probe: edit then accept → `"\uFEFFhhours1\n\nf\n"`.
- Conflict on line 1 of BOM file (`createConflictMergeModel` L39-51 maps on BOM-prefixed text): marker parser sees `"\uFEFF<<<<<<<"`, `startsWith` fails → no marker block; content search finds `ours` line → mapped `exact` range 2-2 without markers; `readiness.hasMarkers=false`; Accept ours leaves raw `<<<<<<<` lines and reports resolved/ready. Probe P1: region `exact` 2–2.
- Existing BOM test (L607-627) only covers conflict on line 2, no whole-file/manual-edit/line-1.
- Fix: single representation. Map + replace on BOM-less `body`; derive `resultText = applyBOM(body)` only at output; strip BOM at every ingress (`applyManualResultTextEdit`, `confirmWholeFileAction`, `restoreModelDecisions`). Add tests: BOM × {line-1 conflict, manual edit→accept, rebuild→accept, accept→undo→redo}.

**C-B. Accept/whole-file with no text change is not undoable.** `applyDraftUpdate` early-returns on `draft.result === newText` (transitions L117) → no history entry, yet store then overwrites `draft.mergeModel` with accepted/reviewed decisions (store `acceptSide` L405-407, `acceptBoth`, `confirmWholeFileAction`). Probe: marker-free worktree already equal to ours (the exact AC4 imported partial-CLI-edit case) → `acceptSide` success, `history.past=0`, `undo()=false`, decision stays accepted/reviewed, `isDirty=false` (draft could be discarded without confirm). Violates "every accept/ignore transaction on one history". Fix: route all store actions through one `applyAtomic(text, decisions, description)` that always pushes an entry when decisions change.

## Warnings
- **W1. History coalescing merges unrelated commands.** `ignoreSide`/`markReviewed` do not reset `canCoalesceHistory`; typing within 500 ms after Ignore/Accept coalesces into that entry (probe: past stays 2 after type-after-ignore) → one Undo reverts typing AND the decision. Break coalescing on any metadata/atomic command.
- **W2. Metadata history unbounded + unaccounted.** `ignoreSide`/`markReviewed` push full-text entries without `checkProspectiveEditGrowth`, `calculateDraftMetrics`, depth cap, or no-op dedupe. Probe: 5000 `markReviewed` → `past=5002`, `metrics.historyBytes=0`. Capacity gate bypassed (AC11 memory/DoS). Also `mergeModel` (stage content+tokens+region copies) and decisions not in `DraftMemoryMetrics`.
- **W3. Two history mechanisms, one unwired.** `JointHistoryAuthority` (own stacks, `setValue`-based) vs `draft.history`. No bridge; `saveJointHistory/getJointHistory/draft.jointHistory` dead; browser test 1 still uses legacy string `recordMetadataAction/onMetadataChange`. Decide: Phase 07 consumes `draft.history` via thin Monaco adapter, delete the parallel stacks + dead store API; or the reverse. Don't ship both.
- **W4. Authority defects carried from cycle 1 (code-read):** (H3) caller order `model.setValue()` then `recordAtomicAction()` makes the content listener push a `text` tx first → 2 undo steps per atomic action (tests undo once, so miss it); (H4) `editor.addCommand` ×3 not disposable and duplicates `addAction` keybindings, `undo/redo` unguarded after `dispose()`; (H6) every undo/redo is whole-doc `model.setValue` (resets cursor/selection/scroll, O(N)); `undo()` pops before side effects (tx lost if callback throws).
- **W5. Preview binding weak.** `confirmWholeFileAction` store check is `if (preview.draftKey && …)` — omitted key skips identity check (probe: accepted). Revision check uses `model.resultRevision` (probe: model rev 3 vs `draft.resultRevision` 1 after metadata actions → two counters). Make `draftKey` required; bind to one revision + result digest.
- **W6. Stale decisions after manual edit (M1 unchanged).** Accept → unrelated text edit → region `unmapped` but `accepted/reviewed`, `isReady=true` (probe). Only `ambiguous` is forced to `needs-review` (`applyManualResultTextEdit` L533-537). Downgrade previously-exact regions that become unmapped.
- **W7. Browser proof gaps (plan step 12/AC3).** Uses `model.applyEdits` not typing; no context-menu Undo, IME, hide/reopen of retained editor, terminal-handoff/refresh; native keyboard proof not against the store/draft path.
- **W8. Missing features/tests.** "Apply nonconflicting changes" (step 6) still absent; whole-file previews don't report replaced imported/manual work beyond `affectedRegions`; no tests for rebuild-cancel byte identity (AC4), mixed/no-EOF round-trip through accept+undo (AC7), source-hash immutability, store-level whole-file undo, over-limit handoff (AC11).
- **W9. Marker parser looseness (M5).** `startsWith("<<<<<<<")` / `"======="` accept any suffix/length (`<<<<<<<<<`, setext `=======`), no ordering validation, unmatched block silently dropped; `zdiff3`/`partial` styles never produced.

## Suggestions
- Perf (M2/M3): metadata actions + undo/redo each do full retokenize/remap (undo = 2 remaps; store accept = remap in `applyDraftUpdate` then discarded). Reuse mappings for metadata-only; precompute joined strings once; debounce remap on typing.
- DRY: three preview builders near-identical; decision-map copy loop ×6; next/prev unresolved filter duplicated; 5× identical try/catch in store → `withDraftAction(key, fn)`; use `{ok,error}` result instead of throw-as-control-flow.
- Dead fields: `JointTransaction.cursorBefore/After/timestamp/description`; `getSnapshot` "serializable" doc but type refs `monaco.Position`.
- `unresolvedReasons` non-empty while `isReady=true` — make advisory marker note a separate `warnings[]`.
- Navigation when all unresolved are `unmapped` always returns first element (stuck).
- Empty-base rebuild omits `|||||||` section (diff3 style lost).

## Positive
- Clean module split under 650 LOC each; barrel re-export; lossless tokenizer; absent vs empty stage retained.
- `claimedRanges` fix is correct and tested; readiness rewrite (reviewed state decides, markers advisory) matches design contract.
- Store guard + decision-snapshot history is a real, tested improvement; undo/redo of Accept restores text+decisions.
- Fail-closed destructive actions on ambiguous/unmapped; no content in errors/logs; no HTML injection surface.
- tsc clean; 55 unit + 2 browser tests green.

## Recommended actions (priority)
1. C-A: single BOM-less body for mapping/replace/offsets; ingress normalization; 4 BOM tests.
2. C-B + W1 + W2: one atomic store command path always creating exactly one history entry, breaking coalescing, applying capacity/metrics/depth cap, deduping no-ops.
3. W3/W4: pick one history owner; delete dead authority/store API or wire it; fix double-entry, disposable-only registrations, minimal-edit undo.
4. W5/W6: required `draftKey` + single revision/digest; downgrade stale reviewed→needs-review on unmapped.
5. W7/W8: browser tests for context-menu Undo, typing, hide/reopen, handoff; add AC4/AC7/AC11 fixtures; implement apply-nonconflicting.

## Reviewed files
`conflict-merge-types.ts`, `conflict-tokenization.ts`, `conflict-marker-parser.ts`, `conflict-region-mapper.ts`, `conflict-merge-actions.ts`, `conflict-merge-model.ts`, `conflict-merge-model.test.ts`, `joint-history-authority.ts`, `joint-history-authority.test.ts`, `conflict-draft-types.ts`, `conflict-draft-transitions.ts`, `conflict-draft-store.ts`, `conflict-draft-store.test.ts`, `hooks/use-conflict-resolver.ts` (diff), `browser-tests/conflict-monaco-history.browser.tsx`; context: `conflict-draft-capacity.ts`, phase-06 plan, cycle-1 report.

## Unresolved questions
1. Server `textTokens` carry U+FEFF inline (no BOM handling found in `server/src/git/conflict.rs`) — confirm intended; is BOM only on worktree or also stages (hasBom derived from worktree only)?
2. Who owns final history: Phase 05 `draft.history` (now decision-aware) or `JointHistoryAuthority`? Needs a decision before Phase 07 renderer wiring.
3. Should a manual edit that makes a reviewed region unmapped require re-review (spec "remap or require review")?
4. AC11 numeric bound (max lines/regions/history bytes) still undefined in code.
