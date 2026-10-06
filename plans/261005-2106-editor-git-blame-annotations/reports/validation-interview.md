# Validation interview — 2026-10-05

## Outcome and authority

Three questions asked; all answered. Planning only; implementation remains pending. Phase files were left unchanged during the original interview as required by its workflow. The user subsequently requested implementation-ready reconciliation; the answers below are now incorporated into contracts, affected phases, verification, index and planned architecture notes. No outstanding interview-driven revisions.

## Confirmed decisions

| Topic | User answer | Required behavior |
|---|---|---|
| Narrow editor | Compact on narrow editors | Reduce annotation width and show author only when space is tight. Date and exact timestamp/timezone/hash/subject remain available in hover; normal widths retain author/date. Do not disable annotations or obscure existing Git markers/fold controls. |
| External Git changes | Focus or manual refresh only | No feature-added periodic root/HEAD polling. Refresh on focus/visibility restoration or explicit Refresh. Preserve independent editor edit/save/reload, relevant FS events and in-app Git invalidation triggers. External HEAD changes while continuously focused may remain stale until a relevant event or focus/manual refresh; do not promise automatic interval-based detection. |
| Commit opened from blame | Read-only inspection | Exact full message, changed files and historical diffs only. Selecting a real history row restores existing action eligibility. Never fabricate branch/reachability/push metadata or weaken existing mutation gates. |

The first two answers revise the draft. The third confirms the existing read-only inspection contract.

## Required plan revisions — completed 2026-10-05

- [x] `contracts.md` §5: focus/manual/source/relevant-event refresh, no feature-added polling or cache-refetch loop; §6: stable wrapper≥640px →220px author/date, below640 →author-only `min(120px, wrapperWidth / 3)`, full hover/focus metadata. Reuse current MonacoHost ResizeObserver lifecycle; dimensions remain subject to actual visual proof.
- [x] Phase01 freshness note; Phase03 requirements/query changes/steps/regressions/tasks/success/risk; Phase06 source/freshness integration; Phase07 qualification/performance reconciled. Scoped ownership, latest-buffer freshness, debounce, two-worker admission and no-retry invariants retained.
- [x] Phase04 sizing/refresh-menu/rendering/geometry/risk; Phase06 wrappers and Phase07 narrow-layout acceptance cover normal/compact transitions,639/640, narrow Split on wide viewport, full metadata, no overflow/loop and intact cursor/scroll/dirty bytes.
- [x] `verification.md` A02/A04/A05/A10 and regression/runtime recipes cover compact metadata, focus/manual external HEAD refresh with unchanged mtime, no feature-added periodic work, separate edit/FS/in-app Git triggers, read-only inspection and real-history action restoration.
- [x] `plan.md`, `cmd-plan.md` and planned architecture notes reflect reconciled decisions. Phase05 explicitly accepts no inspection mutation controls and canonical history restoration; Phase02 requires no changes because its existing native/read-only API contract is unaffected. Structural/consistency results are recorded in [plan validation](./plan-validation.md).

## Recommendation

Planning is ready to begin Phase01 after separate implementation authorization; application code remains unchanged. Native rename/CRLF/display-row proof, actual-browser/full-app qualification and human visual acceptance remain implementation gates, not planning blockers or claimed passes.

## Unresolved questions

None for product scope or interview reconciliation. Native semantics, responsive visual proof and runtime/human prerequisites are execution gates defined by the phases.
