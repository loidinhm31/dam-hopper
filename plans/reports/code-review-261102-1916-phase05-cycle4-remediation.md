# Code Review — Phase 05 remediation, Cycle 4

## Overall assessment

**Score: 7/10 — request changes.** Search result-query binding and per-mode typing now follow the intended contract; canonical path resolution and clean-save reconciliation improved but retain correctness gaps. **0 Critical, 2 High, 2 Medium warnings.**

Focused review of five named Cycle 4 remediations and directly affected callers/tests, against the accumulated working diff (no isolated Cycle 4 commit supplied). Security, performance, architecture, YAGNI/KISS/DRY considered. Runtime failure scenarios below are **[INFERENCE] from inspected source**, not newly executed reproductions. No source/test/plan/task-state edits; this report only. Existing Phase 05 plan remains coordinator-owned and already records technical acceptance incomplete.

## Critical issues

- **None established at Critical severity within this scope.** No new endpoint/dependency, authentication bypass, exposed credential or injection sink identified. Not whole-repository security certification; mutation/coherence risks below remain actionable.

## Warnings

### C4-W1 — High: content inequality is not a post-write freshness boundary

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:233-246,382-395,482-527,783-790`.

`preSaveServerModifiedRef` is assigned after write acknowledgement, but its value comes from the save handler's captured `data`. Reconciliation accepts any current `data.modified` different from that captured string. No request/version identity proves that accepted data was read after the write.

**Failure/impact [INFERENCE]:** cache is O when Save starts; an already-running refetch returns B while stat/write is pending; write of A succeeds. The handler records O and pins A, but the effect sees the existing B != O and clears the pin immediately, showing pre-write B as the clean baseline before post-write invalidation completes. A failed/delayed invalidation prolongs this wrong state. Conversely a genuine later external revert to O remains indistinguishable from the old cache and can leave A pinned indefinitely. The ordinary O → saved A / newer B case improved, but chronology is not established.

**Correction:** retire the pin using the same-document/owner result of a confirmed post-write refresh or explicit request/revision boundary, not text inequality alone. Retain newer local dirty edits. Test refetch B arriving during stat/write, delayed/failed post-write refresh, post-write A/B, and a legitimate post-write return to O. **Confidence: high for branch behavior; sequencing not runtime-exercised.**

### C4-W2 — High: aggregate lookup can resolve a path to the wrong repository/file

**Evidence:** `packages/ui/src/os/apps/ChangesApp.tsx:55-78`; canonical identity `packages/ui/src/components/organisms/ChangedFilesList.tsx:287-318`; aggregate entries `server/src/api/git_diff.rs:494-522`; URL root parsing/delivery `packages/ui/src/os/deep-links.ts:113,129-134,185-192`, `packages/ui/src/os/OsShell.tsx:715-720,731-760`.

The lookup uses one first-match predicate: canonical project path equals request **or** root-relative `e.path` equals request. A root-relative alias can therefore win before a later exact canonical match. It also does not constrain lookup by an explicitly requested root; the Changes URL intent currently drops that root.

**Failure/impact [INFERENCE]:** aggregate entry 1 is `{rootId: "a", path: "b/file.ts"}`; entry 2 is `{rootId: "b", path: "file.ts"}`. Requesting project path `b/file.ts` selects entry 1 through `e.path`, then constructs canonical selection `a/b/file.ts`. The viewer can display/edit the wrong file even though the exact canonical entry exists. Repositories containing repeated relative paths make this a real identity collision, not just missing display metadata.

**Correction:** match canonical project paths first and exclusively for path-only project-path intents. If root-relative requests are supported, require/preserve an explicit root and match `(rootId, diffPath)`; reject ambiguity rather than choosing array order. Keep `createChangedFileSelection` for the resolved entry. Add colliding nested-root and explicit-root URL tests that assert rendered target/path/classification. **Confidence: high.**

### C4-W3 — Medium: resolved Changes intents are replayed on unrelated query refreshes

**Evidence:** `packages/ui/src/os/apps/ChangesApp.tsx:55-95,163-183,211-227`; invalidation includes aggregate diff at `packages/ui/src/api/queries.ts:333-350`; nonce-consumption standard `docs/code-standards.md:115`.

The delivery effect depends on `diffEntries`, loading state and the full `window.appState`, but has no consumed-delivery guard. Every changed diff response re-applies the old selection and `setActiveTab("diff")`, including the metadata-complete branch. Query invalidation on save and ordinary focus/refetch can change entries without a new intent.

**Failure/impact [INFERENCE]:** receive a diff intent, click actual Files or Commit tab, then an unrelated changed-file update/refetch arrives: the old intent reopens Diff and unmounts the user's current tab. Pending path resolution needs query dependencies, but a completed delivery must not remain a permanent tab command.

**Correction:** resolve a pending request once per delivery ID; mark consumed only after resolution or an authoritative unavailable result. Re-delivery with a new ID must still reactivate Diff. Test actual tab clicks followed by changed diff data and then an identical newly delivered intent. **Confidence: high.**

### C4-W4 — Medium: existing checks do not establish the new behavioral acceptance

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.test.tsx:28-32,272-353`; `packages/ui/browser-tests/os-workspace-apps.browser.tsx:198-236,282-323`; `packages/ui/browser-tests/os-management-apps.browser.tsx:206-231`; latest QA receipt `plans/reports/tester-261102-1911-phase05-cycle5-validation.md:58-104`.

- No rendered SearchPanel regression covers debounce mismatch/button gating, the normalized 200-character boundary, two-window query/scope/replacement isolation, or Contents → Files → Contents retention.
- Clean-save test never supplies a post-save/newer query result. Its queries mock omits `invalidateGitFileOperation`; that call cannot exercise production invalidation and its error is swallowed by the success-path catch.
- Changes tests inspect window appState, not canonical DiffViewer inputs/rendering. The repeated-intent test writes appState directly rather than clicking real local-state tab controls.
- No dedicated one-profile Devices/default-target interaction test. Agent Store browser test does not change a control or assert URL stability despite its title.

**Correction:** add deterministic boundary/result oracles to existing focused tests and rendered journeys for the named acceptance. Repair mock/export completeness, await asynchronous updates/teardown; do not suppress `act(...)` diagnostics. **Confidence: high.**

## Cycle 3 disposition

| Previous finding | Current assessment |
| --- | --- |
| C3-W1 | Settled and debounce live-input mismatch corrected: replacement uses `data.query`, normalized-input coherence, disabled guard and empty mismatched matches. Comparing the first 200 characters is consistent with existing search normalization; extra suffix typing alone is not a new mismatch bug. Dedicated regression still absent. |
| C3-W2 | Pure path requests no longer fabricate modified status; canonical helper reused. Root-collision/exact-resolution problem remains C4-W2. |
| C3-W3 | Ordinary per-mode typing now updates independent local queries because SearchApp no longer overrides them with one controlled query. Rendered isolation qualification absent. |
| C3-W4 | Ordinary clean newer-content adoption added; content equality still cannot establish post-write freshness (C4-W1). |
| C3-W5 | Behavioral acceptance gaps remain C4-W4. |
| Devices picker | One-profile visibility, explicit Current / Default option and default-to-active resolution are present in inspected source. No repeat of obsolete missing-option finding. |

## Suggestions / architecture / performance

1. Remove unused SearchApp imports (`useEffect`, `useState`, `useWindowStore`) and write-only DiffViewer `pendingSaveRefetchRef` plus unused operation payload (`content`, `filePath`, counter where object identity already owns the operation). Prefer one explicit operation/freshness contract over overlapping flags.
2. Isolated SearchPanel still calls unselected `useSearchUiStore()` and rerenders for unrelated legacy-store changes. Narrow legacy subscriptions where practical; no measured performance regression claimed.
3. `key={window.id + deliveryId}` recreates the entire SearchPanel for every query intent, resetting mode/scope/other-mode query/replacement text. Prefer applying a delivery to the intended local content-query state if these other window choices must survive; avoid another mirrored store/router abstraction.
4. Retain canonical shared components, owner-qualified query keys and one bound transport per mutation. No backend endpoint, retry framework, speculative cache or general-purpose orchestration layer is needed for these fixes.

Positive: effective search query frozen with results; isolated local modes authoritative for normal typing; canonical selection helper reused; added/deleted classifications preserved for unambiguous path resolution; explicit Devices selection/default option; mutation owner/generation and live dirty-buffer guards retained.

## Reviewed files

Relevant source sections/diffs (approximately 2,000 source/test lines, not a coverage metric):

- `packages/ui/src/components/organisms/{SearchPanel,DiffViewer,ChangedFilesList,LoginDevicesSection}.tsx`
- `packages/ui/src/components/organisms/{DiffViewer.test.tsx,login-devices-owner.ts}`
- `packages/ui/src/components/pages/DevicesPage.tsx`
- `packages/ui/src/os/apps/{SearchApp,ChangesApp,SettingsApp}.tsx`
- `packages/ui/src/os/{OsShell.tsx,intents.ts,deep-links.ts}`
- `packages/ui/src/hooks/{use-file-search,use-search-panel-replace}.ts`
- Test-case inventory: `packages/ui/src/hooks/use-search-panel-replace.test.tsx`
- `packages/ui/browser-tests/{os-workspace-apps,os-management-apps}.browser.tsx`
- Supporting API/root contracts: `packages/ui/src/api/queries.ts`, `server/src/api/git_diff.rs`
- Requirements/guidance: `README.md`, `docs/{project-overview-pdr,code-standards}.md`, `plans/261101-1738-ai-dev-os-redesign/phase-05-app-migration-and-intents.md`, previous Cycle 3 report, Cycle 4 and latest Cycle 5 tester reports, published code-review skill/workflows.

## Validation commands / results

Reviewer executed source reads/searches, `git status --short`, `git diff --stat`, targeted `git diff`, and `date +%y%m%d`. **No reviewer build/test/lint/formatter run**: joined verification belongs to main/tester; supplied execution results were not rerun.

**QA-reported evidence, not independently executed by reviewer:** latest receipt `plans/reports/tester-261102-1911-phase05-cycle5-validation.md:27-54`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os src/hooks/use-search-panel-replace.test.tsx src/components/pages/AgentStorePage.test.tsx src/components/organisms/DiffViewer.test.tsx` | Exit 0; 12 files; 99 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files; 16 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`; 0 diagnostics; not production Vite bundling. |

**115 unique selected tests reported passing across 15 files.** Receipt also reports React `act(...)` diagnostics. No lint result, production-bundle result, measured performance result, type-coverage percentage or test-coverage percentage available. Earlier Cycle 4 receipt's Search source observations predate current edits; current source and latest receipt used for disposition.

## Unresolved questions

- No product clarification blocks C4-W1–W3: request freshness, exact canonical/root identity and one-time delivery follow existing contracts.
- Exact runtime outcomes of the source-derived races/collisions remain unexercised; current tests do not cover them.
- Broader Phase 05 gates (offscreen Session Changes retirement, physical PTY/IME/paste containment, full navigation/basename parity, feature parity and production bundling) are outside this focused Cycle 4 review, not newly qualified by the selected passes.
