# Code Review — Phase 05 application catalog and deep links, Cycle 5

## Overall assessment

**Score: 5/10 — request changes. All Cycle 4 warnings are not resolved.** The new hardening is useful, but several direct omissions remain even within the six named Cycle 5 contracts. Broader Phase 05 acceptance remains incomplete: advertised actions lack consumers, management delivery is not owner-independent, dirty diff state is disposable, and Session Changes lacks reliable focus/PTY containment and offscreen lifecycle management.

Method: published `code-review` skill; targeted source/diff review against Phase 05, Cycle 4 report, PDR and ownership standards. Not a whole-repository security audit. Runtime consequences below are **[INFERENCE]** from inspected control flow unless explicitly attributed to tester evidence. No production/test/plan/task-state edits; this report is the only authored artifact. Plan stays pending. Joined checks remain main/tester-owned per phase contract.

## Cycle 4 resolution ledger

| ID | Cycle 5 result |
| --- | --- |
| C1 | Direct cross-profile DiffViewer transport routing remains resolved. Completion safety still open under W0. |
| C2 | Qualified project-search fallback and empty-federation ambient fallback resolved. Result handoff/Replace All retirement remains open under W0. |
| W0 | **Open / High.** Revision invalidation now exists, but no post-write revision check; superseded pre-write save can remain stuck saving. Replace Next captures one owner, while Replace All and result opening still ignore match generation. |
| W1 | **Open / High.** Missing advertised intent consumers and ignored/reused payloads remain. |
| W2 | **Partial / High.** Shell handler now captures generation; parser no longer fabricates zero. Deep-link pre-open can bypass immutable capture; matcher permits unknown-generation wildcard; offscreen purge remains absent. |
| W3 | **Partial / High.** Ready-transition focus and most root refs added. Claim-denied root still has no ref; zero-tabbable branch escapes; negative-tabindex elements remain eligible; activation recovery/PTY dispatch gate absent. |
| W4 | **Partial / High.** Requested-operation claim and active-operation mismatch view added. Missing/`none` operation is exempted from mismatch, so requested-operation absence is not uniformly fail-closed. Reused filePath remains mount-only. |
| W5 | **Open / High.** Agent Store still URL-coupled; singleton Settings still ignores delivered target/tab changes; Devices explicit profile is initial-only. |
| W6 | **Partial / Medium.** Positive integer line parsing and optional generation parsing added. Router/navigation identity, supported-action validation and dispatch outcome handling remain absent. |
| W7 | **Open / High.** Editable diff and view state still local/disposable; persistence projection not wired to consumers. |
| W8 | Destructive replacement remains resolved. **Medium residual:** project-context validation and lazy app loading still absent. |
| W9 | **Open / High.** Two parser tests added; behavioral safety/feature regressions requested in Cycle 4 still untested. |
| W10 | **Partial / High.** Tunnel browser callback now receives authoritative row profile; Ports adapter retains qualified default; installer closure dependencies/catch owner check improved. Progress/reconnect/state still ambient; aggregate install still selects first owner. |

## Critical issues

**None established at Critical severity.** No backend endpoint/authentication/schema change, exposed secret, or exploitable injection path established in inspected scope. This does not negate the High mutation, data-loss and terminal-isolation findings below.

## Warnings / required corrections

### W0a — High: DiffViewer still clears newer edits after write; invalidated saves can lock saving state

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:202-214,274-278,353-370,396-443`.

Revision now increments on identity changes, model edits and unmount, and generation is checked before and after writing. However, revision equality is checked only after `fsRead`, not after `fsWriteFile`. A user edit/file switch during write is followed by unconditional `savedContentRef.current = content`, `setSaveState("idle")` and `setIsDirty(false)` for the old save. Same-generation fencing cannot distinguish two files or edits. If typing instead invalidates revision while stat is pending, line 370 returns without clearing `saveState = "saving"`; subsequent Ctrl+S is rejected by the saving guard. `onTargetUnavailable` is invoked on failed write/catch before revision checks, so stale failures still publish through that callback.

**Impact [INFERENCE]:** unsaved newer edits marked clean, another selection's state reset, stale unavailable state, or save disabled until identity reset.

**Correction:** separate operation lifetime from edit identity. Recheck exact owner and current identity/edit revision immediately after every await and before every state/callback publication. On superseded pre-write completion, release this operation's saving status without marking newer content clean. Preserve dirty comparison against actually written content. Add delayed-stat and delayed-write regressions covering typing, file switch, unmount and errors. **Confidence: high.**

### W0b — High: Replace All and result opening still accept retired search matches

**Evidence:** `hooks/use-search-panel-replace.ts:138-175,194-218,310-335,342-413`; `os/apps/SearchApp.tsx:42-52`; `os/intents.ts:54-60` (paths under `packages/ui/src/`).

Replace Next now rejects an old match generation and reuses its captured owner through read/write: positive. Replace All still groups without generation, captures the currently connected owner, and never compares it with any `group.matches[].generation`. Its current-connection checks establish only that the newly captured owner remains current, not that it owns the original matches. SearchApp drops match generation when opening; `file:open` cannot carry it.

**Impact [INFERENCE]:** a retained generation-1 result can replace or open against generation 2. Current mtime CAS does not prove old search ownership; it only protects the newly read file version.

**Correction:** validate originating generation for every replace group and click/open; preserve owner through action delivery; reject mismatched/mixed owners before reading/writing/opening. Keep one operation snapshot for each file and fence final publication. **Confidence: high.**

### W1 — High: retained catalog actions and payload journeys still incomplete

**Evidence:** `os/app-registry.ts:11-128` versus all registrations in `os/OsShell.tsx:210-576` and `os/apps/FilesApp.tsx:63-80`. No production OS consumers for terminal focus, file edit, browser preview, search query, Changes actions, Git diff/history/branch/reveal-commit, conflict reveal, workflow plan, ports open-tunnel, project config or Settings devices.

`OsShell.tsx:86-145` pre-opens and dispatches before newly opened adapters mount; this effect also precedes shell handler registration. Files ignores seeded file payload (`FilesApp.tsx:19,63-80`). Terminal/browser consumers unconditionally create windows (`OsShell.tsx:213-233,290-303`), allowing duplicate destinations on later deep links. Terminal-open supplies cwd, while `TerminalsApp.tsx:18-20` expects sessionId or a synthetic default and does not compose the retained navigator/controller. `EditorApp.tsx:22-35` never consumes line. Resolver filePath is an initial state only (`ConflictResolverApp.tsx:22,62-76`); Workflow selectedItemId is never consumed (`WorkflowPlansApp.tsx:44-55`).

**Impact [INFERENCE]:** silent no-ops, missing terminal surface, wrong selection/line and duplicate windows despite handled launch results.

**Correction:** one launch-and-deliver path reading current store state, with supported consumers and reactive canonical payload delivery for both cold and reused destinations. Await/report canonical open failures rather than dropping promises. Preserve every retained feature contract rather than narrowing the catalog. **Confidence: high.**

### W2 — High: generation capture is not guaranteed at window creation; hidden reviews do not retire

**Evidence:** `OsShell.tsx:103-139,347-390`; `app-registry.ts:200-217`; `apps/SessionChangesApp.tsx:24-37,81-104`; `DesktopCanvas.tsx:40-53,95`; `OsShell.tsx:727-731`.

The direct session handler now stores captured/live generation in ctx and appState. But deep-link pre-open uses parsed ctx, which does not include generation (`deep-links.ts:129-135,233-252`). With omitted generation, pre-open appState also has none. Matcher explicitly treats a missing generation on either side as a wildcard. Reusing that pre-open window updates appState but not ctx; the component's captured ref may already be initialized. A visibility unmount/remount can capture a new live generation when stored identity was never stamped. Disable/retirement cancellation and purge exist only inside this visibility-mounted adapter.

**Impact [INFERENCE]:** a review created without durable in-memory generation can rebind on remount; hidden reviews/cache outlive disable/disconnect until mounted again. Unknown-generation reuse cannot establish the exact tuple contract.

**Correction:** stamp and validate generation before publishing any review window; compare exact tuple without unknown-generation wildcard; host lifecycle retirement/purge outside visibility-only bodies. Preserve sensitive-data persistence exclusion. **Confidence: high.**

### W3 — High: focus trap still escapes and cannot guarantee zero background PTY input

**Evidence:** `apps/SessionChangesApp.tsx:77-79,126-158,194-211,215-227`; `apps/TerminalsApp.tsx:40-61`; `lib/terminal-host-attachment.ts:23-28,61`; `components/organisms/TerminalPanel.tsx:821-827`.

Claim-denied branch still lacks `ref={rootRef}`, contradicting the all-branches requirement. Loading branch has no descendants matching the selector; Tab returns at line 141 without preventDefault, allowing browser focus outside the review. Button/input alternatives still admit negative tabindex; checking `[tabindex]` only on the final selector alternative does not exclude those controls. Focus effect is not claim-status/activation-aware; no containment recovery after focus is stolen. Terminal attachment still schedules autofocus without suppressing inactive ownership, and terminal write dispatch checks connection/replay rather than active OS input ownership.

**Impact [INFERENCE]:** loading Tab, claim-denied transitions or delayed terminal autofocus can put keyboard/paste/IME into a live background PTY. Stopping propagation inside a review does not intercept an event targeted at xterm.

**Correction:** attach all roots; use actual enabled, visible, nonnegative-tabindex tabbables, containing zero-control Tab on root; recover focus according to active window ownership; suppress background autofocus and gate PTY writes at dispatch. Test actual focus and zero bytes with a live focusable terminal boundary. **Confidence: high.**

### W4 — High residual: requested operation unavailable is not uniformly rejected

**Evidence:** `apps/ConflictResolverApp.tsx:36-57,133-159,173-188,231-243`.

A differing active non-`none` operation is now rejected and claim identity prefers requested operation: positive. Mismatch deliberately excludes null/`none` live operation. If a requested merge has no live operation but unmerged entries remain, `isNoOperation` is false and mutation-capable MergeConflictEditor still mounts, even under the requested merge claim. The phase requires unavailable requested operations to fail closed, not only merge-versus-rebase mismatch.

**Correction:** while loading show loading; once loaded require any explicit requested operation to equal the actual available operation, including rejecting missing/`none`. Do not mount mutation-capable content otherwise. Preserve generic no-operation conflict handling only for deliberately unqualified requests. **Confidence: high on branch behavior; specific repository state not runtime-exercised.**

### W5 — High: management windows still ignore explicit delivery and share URL state

**Evidence:** `components/pages/AgentStorePage.tsx:63-64,80-112,175-179`; `apps/AgentStoreApp.tsx:16-23`; `components/pages/DevicesPage.tsx:22-24`; `OsShell.tsx:481-507`; `apps/SettingsApp.tsx:10-13,46-52`; `components/pages/SettingsPage.tsx:44-79`.

Agent Store reads/writes route query for profile/tab even when explicitly scoped; selector edits URL but explicitProfileId still wins. AgentStoreApp ignores delivered tab and erases qualified default. Settings singleton reuse changes appState activeTab only, not target; local state does not react to that update. SettingsPage receives no requested target and retains global Settings selection. Deep-link pre-open seeds `tab`, while SettingsApp expects `activeTab`. Devices uses explicit profile only as initializer.

**Impact [INFERENCE]:** cross-window URL/tab coupling, ineffective selection and management of a server other than the requested one.

**Correction:** controlled, URL-free canonical body props with explicit target/tab callbacks; route adapters translate URLs only for legacy routes. Reactively deliver singleton target/tab while preserving distinct server-target and preferences-source choices. **Confidence: high.**

### W6 — Medium: parser improvement does not fix navigation consumption

**Evidence:** `deep-links.ts:65-78,100-110,233-244`; `OsShell.tsx:86-155`.

Ordinary malformed line suffixes/negative/noninteger values are rejected, and optional session generation is parsed. However, action-only links accept arbitrary actions; integer validation uses `Number.isInteger` rather than safe-integer bounds. Shell still observes raw window.location.search, lacks router location dependencies/idempotent navigation identity, clears search/hash through raw replaceState, and ignores dispatch result.

**Impact [INFERENCE]:** same-route/back-forward requests ignored or silently lost; malformed/unhandled requests appear accepted. No executable URL injection established.

**Correction:** router/basename-aware consumption keyed to navigation identity; whitelist supported actions, safe-bound numeric identities, surface unavailable/unhandled outcomes. **Confidence: high on source omissions.**

### W7 — High: unsaved diff/view state still disappears on ordinary transitions

**Evidence:** `apps/ChangesApp.tsx:20-24,37-54,95-160`; `DesktopCanvas.tsx:40-53,95`; `persistence.ts:61-96`; `apps/ProjectInfoApp.tsx:25`.

DiffViewer is unmounted on Files/Commit tab selection, minimize, pane inactivity or desktop changes. Its editable content/dirty state is component/model-owned, with no canonical draft retention or dirty transition guard. Changes selection/tab and Project Info tab are local; adapters do not publish/consume projected appState. Selecting a file does not activate diff, only emits currently unhandled changes:diff. Agent Store stores `tab` while persistence permits `activeTab`.

**Impact [INFERENCE]:** unsaved edits and approved view state lost during normal shell use.

**Correction:** retain drafts in canonical memory resources, guard dirty transitions, and connect approved view-state publication/consumption. Never serialize file/resolver/session contents to localStorage to solve lifecycle loss. **Confidence: high.**

### W8 — Medium: template context and eager catalog imports remain

**Evidence:** `CommandPalette.tsx:161-181`; `OsShell.tsx:6-19`.

Template append is non-destructive. It still allows no project, making project-required apps unusable. All app bodies remain eager imports despite the phase's lazy catalog requirement. **Impact [INFERENCE]:** invalid project desktop and unnecessary initial loading; bundle delta not measured.

**Correction:** require valid project context; follow existing lazy/Suspense conventions. Exercise the actual palette command on a populated desktop. **Confidence: high.**

### W9 — High: passing tests do not cover the defects they are used to close

**Evidence:** `browser-tests/os-review-apps.browser.tsx:158-219,267-317`; `browser-tests/os-workspace-apps.browser.tsx:108-194`; `browser-tests/os-management-apps.browser.tsx:176-204`; `src/os/app-registry.test.ts:156-170,233-259`; `src/os/deep-links.test.ts:122-163`.

Review input test only dispatches synthetic Escape at wrapper, not real Tab, focus, paste, IME or terminal writes. Tuple test lacks generation. Management template test manually reproduces append rather than invoking palette. Workspace tests assert mount/handler status, not canonical action outcomes. Cycle 5 adds parser assertions, not delayed-save, stale Replace All, operation-unavailable, focus/hidden lifecycle or owner-bound install journeys.

**Correction:** regressions for W0–W10 at the lowest reliable layer, particularly deferred-await safety and real browser ownership/input transitions. Current 70 passing checks do not certify all Phase 05 acceptance rows. **Confidence: high.**

### W10 — High: installer lifecycle remains ambient and aggregate target is arbitrary

**Evidence:** `hooks/use-ports.ts:84-106,271-346,348-380`; `components/organisms/PortsPanel.tsx:642-668`; `apps/PortsTunnelsApp.tsx:16-35,47-49`.

Row profile now reaches Browser and qualified default is preserved: resolved. Installer closure now includes targetOwners and catch checks current owner. But progress handlers discard event profile/generation, compare ambient transport, and update ambient-generation state. Reconnect status probes ambient transport. Any current owner's install event can affect another pinned panel. `targetOwner.generation !== requestGeneration` compares the same captured value, not current panel identity; switching explicit target A→B while A remains connected permits A's later failure into B. Aggregate installer selects targetOwners[0], not the failed row; UI discards the failed targetProfileId. Bound transport retrieval occurs before try, so disconnected install can reject outside the handled path.

**Impact [INFERENCE]:** wrong-host install in aggregate view, cross-owner/misleading progress and stale errors, unhandled unavailable-owner rejection.

**Correction:** retain explicit failed-row owner and one install-operation identity; state/events/status/completions must all use that exact owner/generation and current panel revision. Move acquisition into handled path; never substitute first target. **Confidence: high.**

## Suggestions / positive observations

- KISS/DRY: a small shared launch-and-deliver helper would remove repeated shell handlers and make cold/reused-window semantics consistent; avoid a second feature-controller framework.
- Type `AppManifest.intents` as supported action types rather than unrestricted `string[]`; test retained manifest actions against real consumers.
- Remove/wire dead Git callbacks and resolver maximize/drag no-ops. No new abstraction is needed to hide incomplete behavior.
- Good: single qualified DiffViewer transport, explicit generation checks, failed qualified search remains fail-closed, empty federation no longer falls back, Replace Next owner reuse, strict ordinary line parsing, requested-operation claim preference, authoritative tunnel row source, non-destructive desktop append.
- Sensitive review/resolver state remains excluded from persistence. Keep this boundary.
- Performance: eager imports and repeated large shell launch blocks remain maintainability/load concerns. No measured CPU/memory/bundle regression claimed; no dependency expansion observed in inspected change set.

## Reviewed files

Paths under `packages/ui/` unless stated. Large supporting files inspected in targeted sections, not in full.

- Production modifications: `src/components/organisms/{DiffViewer,PortsPanel,SearchPanel}.tsx`; `src/components/pages/{AgentStorePage,DevicesPage,SettingsPage}.tsx`; `src/embed/dam-hopper-app.tsx`; `src/hooks/{use-file-search,use-ports,use-search-panel-replace}.ts`; `src/os/{OsShell,CommandPalette,Dock}.tsx`; `src/os/{app-registry,intents,persistence,types,window-store}.ts`.
- New production: `src/os/{deep-links,desktop-templates}.ts`; eleven `src/os/apps/{FilesApp,SearchApp,ChangesApp,ProjectInfoApp,GitApp,ConflictResolverApp,SessionChangesApp,WorkflowPlansApp,PortsTunnelsApp,AgentStoreApp,SettingsApp}.tsx`.
- Supporting: `src/os/{DesktopCanvas,window-context}.tsx`; `src/os/apps/{EditorApp,TerminalsApp}.tsx`; `src/lib/{search-replace-next,terminal-host-attachment}.ts`; `src/components/organisms/TerminalPanel.tsx`; `package.json`.
- Tests: `src/os/{app-registry,deep-links}.test.ts`; `browser-tests/{os-workspace-apps,os-review-apps,os-management-apps}.browser.tsx`.
- Requirements/evidence: root `README.md`; `docs/{project-overview-pdr,code-standards}.md`; Phase 05 plan; Cycle 4 review; Cycle 5 tester receipt; published development rules/primary workflow/code-review skill.

## Validation commands / results

Reviewer executed `git diff --stat && git status --short`, targeted `git diff`, source reads and registration/callback searches. No reviewer test/build/lint/formatter/live mutation. Main/tester owns joined verification; no duplicate execution.

**Tester-reported, not independently rerun**, from `plans/reports/tester-261102-1706-phase-05-cycle-5.md:13-21,101-128`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os` | Exit 0; 9 files, 61 passed, 0 failed. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files, 9 passed, 0 failed. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 type errors; not Vite bundling. |
| Same unit/browser commands with `--reporter=verbose` | Reported exit 0; same 61/9 pass counts. |

70 selected tests passed per receipt. Non-failing React `act(...)` warnings remain. Coverage percentages, lint counts, production bundle cost and full UI/canonical parity suites not measured by this receipt.

## Unresolved questions

- Real background PTY keyboard/paste/IME isolation, delayed-stat/write revisions, stale-generation Replace All, hidden review retirement and same-route/back-forward/basename behavior remain unexercised by inspected evidence.
- Production Vite bundle and phase-listed canonical parity suites are not covered by current validation receipt.
- No unresolved product decision blocks remediation; behavior is already specified by Phase 05 and ownership standards.
