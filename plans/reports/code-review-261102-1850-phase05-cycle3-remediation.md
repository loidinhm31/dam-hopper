# Code Review — Phase 05 remediation, Cycle 3

## Overall assessment

**Score: 7/10 — request changes.** Immediate Cycle 2 defects materially improved, but replacement still lacks a frozen result-query contract; metadata-free diff intents still fabricate editable selections. Three medium warnings concern per-mode search state, post-save reconciliation, and incomplete behavioral coverage.

Review focus: Cycle 3 remediations against the accumulated working diff (no isolated Cycle 3 commit supplied), security, performance, architecture, YAGNI/KISS/DRY. Published `code-review` skill, repository standards, PDR, Phase 05 contract, previous review and QA receipt inspected. Approximately 2,500 relevant source/test lines inspected; not a coverage metric. Runtime impacts below are **[INFERENCE]** from source, not newly executed reproductions. No source, tests, plans or task state modified; only this report authored. Existing phase plan records technical acceptance incomplete and remains coordinator-owned.

## Critical issues

**None established at Critical severity.** No new server endpoint, dependency, authentication bypass, credential exposure or injection sink identified within this scope. Remaining mutation/data-integrity risks below must still be corrected. Not whole-repository security certification.

## Warnings

### C3-W1 — High: replacement uses live input with results from a different effective query

**Evidence:** `packages/ui/src/components/organisms/SearchPanel.tsx:98-116,163-180,292-321`; `packages/ui/src/hooks/use-file-search.ts:36-39,67-74,95-114,148-152,256-264`; `packages/ui/src/hooks/use-search-panel-replace.ts:108-109,321-345,433-446`.

The controlled/global mismatch is corrected for a settled search, but `searchQuery` is still the immediate, unbounded input. Search executes a 350 ms debounced query capped at 200 characters. During that debounce the previous results remain available and Replace remains enabled because eligibility checks only input length, result count and busy state.

**Failure/impact [INFERENCE]:** results show files matching `foo`; user changes input to `bar` and clicks Replace All before the debounce expires. The hook replaces `bar` in the old `foo` file groups, not the files/matches produced by a `bar` search. Inputs over 200 characters also permanently differ from the executed search. Thus the claimed exact same effective query snapshot is not established.

**Correction:** expose/use the query associated with the returned results and disable replacement while the normalized requested specification differs from that snapshot. Freeze query/case/scope/owner alongside matches for execution. Test rendered SearchPanel with a deferred/debounced query transition and a >200-character input; assert zero writes until coherent results exist and exact replacement content afterward. **Confidence: high.**

### C3-W2 — High: metadata-free `changes:diff` producers still bypass canonical classification/root resolution

**Evidence:** `packages/ui/src/os/intents.ts:142-151`; `packages/ui/src/os/deep-links.ts:185-193`; `packages/ui/src/os/OsShell.tsx:715-763`; `packages/ui/src/os/apps/ChangesApp.tsx:33-69,200-209`; `packages/ui/src/components/organisms/DiffViewer.tsx:137-147,187-194`; canonical selection construction at `packages/ui/src/components/organisms/ChangedFilesList.tsx:300-318`.

List-originated intents now correctly carry and preserve the canonical selection. However all new metadata fields remain optional, and the actual Changes deep-link producer supplies only filePath. For a newly selected file the consumer still fabricates `status: "M"`, zero counts, window root/`.` and `diffPath: requestedFilePath`.

**Failure/impact [INFERENCE]:** opening an added/deleted file through a fresh URL or another metadata-free intent does not activate DiffViewer's `added`/`deleted` read-only classification. A nested-repository path is still interpreted against an inferred root/path rather than the canonical entry. The list-click instance of C2-W4 is repaired; the advertised external-intent journey is not.

**Correction:** distinguish complete canonical selections from path-only requests. Require canonical fields for internal selection delivery; resolve path-only requests against the owner-qualified changed-file entries before mounting an editable diff, or remain unavailable/read-only until resolution succeeds. Do not synthesize a modified classification. Cover fresh added/deleted/nested-root deep links as well as list clicks. **Confidence: high.**

### C3-W3 — Medium: controlled Search bypasses its supposedly per-mode query state

**Evidence:** `packages/ui/src/components/organisms/SearchPanel.tsx:69-98,210-221,260-265`; `packages/ui/src/os/apps/SearchApp.tsx:19-34,85-92`.

Every OS Search is controlled by one `query` string. Controlled typing never updates `localQueries[mode]`, and mode changes only change `mode`; the same outer string overrides both per-mode values. `localQueries.content` remains its mount-time value in this composition.

**Failure/impact [INFERENCE]:** search Contents for `foo`, switch Files, type `bar.ts`, switch back: Contents now searches `bar.ts`, not the previous content query. Cross-window coupling is fixed, but existing per-mode query behavior is lost and the new local query object is not authoritative.

**Correction:** use one coherent window-local `{mode, scope, queries, replaceQuery}` state contract. Route typed changes into the active mode and explicitly define which mode receives `search:query`; retain legacy store adaptation only for the old route. Test Contents → Files → Contents plus two simultaneous windows. **Confidence: high.**

### C3-W4 — Medium: saved-content override can permanently hide newer server data

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:219-236,504-515,772-777`.

`authoritativeModified` correctly prevents immediate fallback to stale pre-save query content. It is released only when server content equals the saved string or document identity changes. A legitimate newer external version is not distinguished from the stale pre-save value.

**Failure/impact [INFERENCE]:** save A successfully, another actor writes B before the post-save refetch, and that refetch returns B. The clean viewer keeps displaying A. Further refetches returning B cannot release the override, so the clean model can stay stale until document remount or an accidental equality. This is an availability/coherence regression, not proof of the original immediate-save rollback recurring.

**Correction:** pin during pre-save-cache exposure, then reconcile against a known post-write refetch/result for the same document/owner. Accept a genuinely newer authoritative result when clean, updating the saved baseline consistently; preserve current model when dirty. Test delayed old data → confirmed post-save A and delayed old data → externally newer B. **Confidence: high for the branch behavior; runtime sequencing unexercised.**

### C3-W5 — Medium: selected tests still do not close behavioral acceptance

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.test.tsx:28-32,272-353`; `packages/ui/browser-tests/os-workspace-apps.browser.tsx:198-237,282-323`; `packages/ui/browser-tests/os-management-apps.browser.tsx:206-231`; QA coverage analysis in `plans/reports/tester-261102-1846-phase05-cycle3-remediation.md:65-111`.

The new deterministic stat/read gates are useful. The clean-save test also catches the original wrong controlled-prop value, but its queries mock omits `invalidateGitFileOperation`; the production invalidation call cannot run normally and its error is swallowed by the intentional catch. There is no deferred invalidation/refetch result or eventual model update in that test.

The repeated Changes test writes `window.appState.activeTab` directly and asserts the handler writes it back; actual tab buttons update component-local state. It never proves rendered diff reactivation. Search tests do not exercise two-window scope/query/replace isolation or replacement with controlled/global disagreement. Added/deleted/nested-root metadata is not asserted. The Agent Store test still never changes a control or asserts URL stability/profile relaunch despite its title.

**Correction:** retain useful unit prop assertions, add an explicit invalidation/refetch boundary and eventual-data oracle; exercise actual tab controls and rendered target content; add the missing search/metadata/management journeys. Do not equate 115 selected passes with complete remediation acceptance. **Confidence: high.**

## Cycle 2 disposition

| Previous warning | Current assessment |
| --- | --- |
| C2-W1 | Stable controlled/global replacement mismatch corrected; live-input/result snapshot gap remains C3-W1. |
| C2-W2 | Cross-window mode/scope/replace coupling corrected in inspected isolated branch; per-mode query regression remains C3-W3. |
| C2-W3 | Immediate post-save old-prop rollback corrected by authoritative override; future reconciliation gap C3-W4. |
| C2-W4 | Canonical list-selection metadata preserved; metadata-free external path remains C3-W2. |
| C2-W5 | Requested default semantics implemented: visible picker with one profile, explicit default option, default resolves activeProfileId. No repeat of the obsolete missing-option defect; dedicated journey coverage absent. |
| C2-W6 | Deterministic stat/read races and unknown-terminal existing-window rejection added; broader behavioral acceptance remains C3-W5. |

## Suggestions / architecture / performance

1. Remove unused DiffViewer operation fields (`id`, captured `content`, captured `filePath`) and unreachable generation duck-typing after target normalization where no contract supplies generation. Object identity already fences active saves. Keep explicit owner types.
2. Avoid maintaining mirrored query state in window appState, SearchApp local state and unused per-mode SearchPanel values; fix ownership at the existing component boundary, not through another router/store framework.
3. `useSearchUiStore()` still subscribes isolated panels to all legacy store updates. Narrow the subscription where practical; local windows should not rerender for unrelated legacy input. No measured performance regression claimed.
4. Keep shared canonical pages and owner-bound transports. Do not introduce retries, backend endpoints, speculative caches or an additional orchestration layer to resolve these local state-contract defects.
5. Broader Phase 05 gates remain intentionally outside this focused review: offscreen Session Changes retirement, physical PTY keyboard/paste/IME isolation, full navigation/basename parity, canonical feature parity, production bundling.

Positive: canonical components reused; no backend expansion; post-stat dirty check queries live editor state; per-delivery nonce retained; registry-first unknown-terminal rejection; exact owner checks around diff saves; Settings target remains separate from preferences source; canonical selection metadata now survives ordinary list delivery.

## Reviewed files

Relevant sections/diffs of all 20 accumulated changed paths inspected:

- `packages/ui/src/components/organisms/DiffViewer.tsx`
- `packages/ui/src/components/organisms/DiffViewer.test.tsx`
- `packages/ui/src/components/organisms/SearchPanel.tsx`
- `packages/ui/src/components/pages/AgentStorePage.tsx`
- `packages/ui/src/components/pages/DevicesPage.tsx`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- `packages/ui/src/hooks/use-search-panel-replace.ts`
- `packages/ui/src/hooks/use-search-panel-replace.test.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/apps/AgentStoreApp.tsx`
- `packages/ui/src/os/apps/ChangesApp.tsx`
- `packages/ui/src/os/apps/ConflictResolverApp.tsx`
- `packages/ui/src/os/apps/SearchApp.tsx`
- `packages/ui/src/os/apps/SessionChangesApp.tsx`
- `packages/ui/src/os/apps/SettingsApp.tsx`
- `packages/ui/src/os/apps/TerminalsApp.tsx`
- `packages/ui/src/os/intents.ts`
- `packages/ui/browser-tests/os-workspace-apps.browser.tsx`
- `packages/ui/browser-tests/os-review-apps.browser.tsx`
- `packages/ui/browser-tests/os-management-apps.browser.tsx`

Supporting: `hooks/use-file-search.ts`; `components/organisms/{ChangedFilesList,LoginDevicesSection,login-devices-owner}`; `api/queries.ts`; `os/{window-context.tsx,deep-links.ts}`; `README.md`; `docs/{project-overview-pdr,code-standards}.md`; Phase 05 plan; previous Cycle 2 review and current QA receipt; published agent/workflow/review-skill guidance.

## Validation commands / results

Reviewer executed `git diff --stat`, targeted `git diff` inspections, `date +%y%m%d`, reads and callsite/owner searches. No reviewer build/test/lint/formatter run; joined validation belongs to main/tester and reported results were not rerun. No source fixes authorized by this assignment.

**QA-reported evidence, not independently executed by reviewer:** `plans/reports/tester-261102-1846-phase05-cycle3-remediation.md:25-61`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os src/hooks/use-search-panel-replace.test.tsx src/components/pages/AgentStorePage.test.tsx src/components/organisms/DiffViewer.test.tsx` | Exit 0; 12 files; 99 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files; 16 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript check, 0 errors (`tsc -p tsconfig.json`); not production Vite bundling. |

Total reported **115/115 selected tests passed** across 15 files. No lint result, production bundle result, test-coverage percentage or type-coverage percentage supplied. Passing checks do not disprove the unexercised state transitions above.

## Unresolved questions

- No product clarification blocks C3-W1–W4; fixes follow existing canonical-selection, per-mode-state and owner/data-coherence contracts.
- Real Monaco eventual refetch/model synchronization, rendered repeated intent delivery, two-window replacement isolation, two-profile Agent Store relaunch and default Devices target transitions remain unqualified by the current receipt.
- No isolated Cycle 3 baseline supplied; findings concern present source and explicitly distinguish repaired list/settled-query cases from remaining external/race cases.
