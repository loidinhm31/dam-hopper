# Phase 02 — Owner Lifecycle and Gutter

## Context links
- [User approval receipt](../reports/approval-261006-1227-pr48-hardening.json)
- [Parent adjudication](../reports/adjudication-261006-1226-pr48-hardening.md)
- [Code review report](../reports/code-reviewer-261006-1216-pr48-hardening.md)
- [Verification report](../reports/verification-261006-1205-pr48-hardening.md)
- [Debugger report](../reports/debugger-261006-1144-pr48-lifecycle.md)
- [Gutter capture](../reports/browser-261006-1211-pr48-gutter.png), [Font transition capture](../reports/browser-261006-1215-pr48-font-transition.png)
- [Architecture](../../docs/architecture/workbench-files-editor-and-git.md)
## Overview
- Date: 2026-10-06. Priority: P2. Status: completed; Vitest (182 scoped, 21 focused post-cleanup), real Monaco (3/3) and authenticated production smoke passed. User accepted all gates and authorized a scoped commit; no push.
- Preserve existing owner/model epoch design. Repair refresh continuations and public Monaco option access; implement published row-click affordance.

## Key Insights
- Reproduced hook race: ready → deferred roots refresh → toggle off → old refresh rejects → unavailable. Catch publishes after feature loses liveness.
- `triggerRepositoryRefresh` checks identity before await, not after; an old target's roots can modify current root/head refs and status. Runtime confirmation limited to disabled-state rejection; target/generation transitions remain static findings.
- Installed Monaco 0.55.1: lineHeight ID75, glyphMargin ID66. Current fallback66 yields boolean, dropped CSS; real rows16.5px versus editor19px.
- Mouse click committed row focuses only; Enter opens exact commit. Original contracts emphasize menu/Enter, but PR body/receipt advertise row clicks.
- Query invalidation compares project string only; HEAD/root-only refresh gating misses index-only rename baseline changes. Confirm these scenarios before broadening event behavior.

## Requirements
- Every roots success/error continuation validates captured owner generation, tab/target, active feature, and refresh epoch before state publication.
- Old continuations cannot modify new-target refs, restore disabled UI state, or initiate stale work.
- Same-owner/root index changes can refresh attribution without feature-added polling.
- Real row hitbox and line-height match current Monaco configuration.
- Committed row mouse/Enter/context-menu reveal identical owner-bound root/OID; uncommitted rows cannot reveal.

## Architecture
- Keep existing hook, epochs, single-flight controller and event-driven invalidations; no new controller abstraction.
- Capture request identity at refresh start and recheck after await and catch. Ignore obsolete continuations; do not suppress valid current failures.
- Compare full scoped Git query keys using existing `gitQueryKey`/owner conventions, not `key.includes(project)`.
- Query typed public `monaco.editor.EditorOption.lineHeight` as sole authority; clean cutover removed 56 lines of dead fallbacks (constructor probing, mock `getOption(0)`, magic 19 default). Real typed namespace yields no fabricated rows.
- Row click uses same current render's committed/root guard as Enter; existing host generates qualified reveal request.
## Related code files
- Modify `packages/ui/src/hooks/use-editor-git-blame.ts`, existing hook tests.
- Modify `packages/ui/src/lib/editor-git-blame-gutter-layout.ts`.
- Modify `packages/ui/src/components/molecules/EditorGitBlameRow.tsx` and existing gutter/browser suites.
- Reuse `api/ownership.ts`, `connections.ts`, `queries.ts`, `lib/git-commit-reveal.ts`; no exported API redesign.

## Implementation Steps
1. Read references/callers with LSP if configured; currently unavailable.
2. Add captured owner/tab/target/refresh-epoch checks to roots success and failure paths; gate disabled/unmounted completion. Keep current valid failures visible.
3. Clear attribution on actual identity transitions. Verify loading status already hides old data before asserting any visible-leak defect.
4. Reproduce same-HEAD staged-rename invalidation and cross-profile same-name query event; fix only confirmed matching/refresh suppression.
5. Use typed runtime Monaco enum and finite positive-number validation; reuse host namespace where appropriate to avoid avoidable eager editor loading.
6. Add committed-row click guarded identically to Enter; no click-through for Uncommitted.
7. Update existing behavior tests for disabled/target-switch late continuations and actual configured row height, not implementation wording or magic IDs.
8. Smoke real full application mouse/keyboard reveal, changed font/line height, folding and dirty-buffer preservation. Then update feature architecture/changelog.

## Todo list
- [x] Fence roots continuations and failures.
- [x] Confirm index-only refresh and qualified invalidation cases.
- [x] Correct typed line-height lookup.
- [x] Implement advertised committed-row click.
- [x] Run targeted regression and actual application smoke.
## Success Criteria
- Late old roots rejection leaves disabled status off and new-target state intact.
- Root/model/profile generation transitions never publish old metadata or consume old reveal requests.
- Row height equals configured Monaco line height, including non-default values.
- Mouse click, Enter and menu open exact committed OID; dirty buffer unchanged, already-open panel not closed.
- Existing browser/full-app suites pass with strengthened assertions.

## Risk Assessment
- Roots responses can complete after cleanup; abort alone insufficient.
- Overbroad query events waste requests and may abort valid work. Match qualified identity; no generic retry policy.
- Default absolute top offsets hide invalid row heights; geometry tests must assert actual height, not just top alignment.

## Security Considerations
- Owner/generation and target/root qualification remain mandatory at publication/reveal. Never use ambient client fallback.
- Blame metadata remains escaped text; no HTML tooltip injection.

## Next steps
Completed. Verified across Vitest (182 scoped pass, 21 focused post-cleanup pass), real Monaco browser tests (3/3 pass, 20px -> 31px), authenticated production smoke (19px -> 20px font change), and independent code review (9.8/10). Scoped commit pending parent execution; push unauthorized.
