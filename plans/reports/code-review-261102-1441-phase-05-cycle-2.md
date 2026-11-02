# Code Review — Phase 05 application catalog and deep links, Cycle 2

## Overall assessment

**Score: 4/10 — request changes.** Several local repairs are correct, but neither critical owner-isolation finding is fully resolved. Registered handlers do not establish end-to-end delivery; Session Changes still lacks authoritative loading/retirement protection and a focus trap. The new template command introduces an invalid-session path.

Method: read-only source/diff review using the published `code-review` skill. No implementation, plan/task-state edits, or duplicate test execution. This report is the only authored artifact. Static findings have high confidence; runtime consequences not independently exercised are labeled **[INFERENCE]**. Scope: current Phase 05 working-tree production additions/modifications, their tests, and supporting owner/resource controllers; approximately 5,000 lines of targeted sections. Not a whole-repository security audit.

## Resolution ledger

| Finding | Cycle 2 status |
| --- | --- |
| C1 | **Partial/open.** Project Info config hooks and panel target are qualified; DiffViewer save remains ambient. |
| C2 | **Partial/open.** SearchPanel preserves profile and SearchApp uses source profile/project; qualified search/replace fallback, source worktree handling and generation fencing remain unsafe. |
| W1 | **Partial/open.** Five shell consumers added and router continues past `unhandled`; most catalog actions still lack consumers, existing destinations do not receive payloads, initial delivery races remain. |
| W2 | **Partial/open.** Explicit close/disable removes cache and panel has a tuple key; loading still mounts it, captured generation is discarded, retiring-owner cleanup absent. |
| W3 | **Open.** One mount-time `.focus()` is not a focus trap or activation/input gate. |
| W4 | **Partial/open.** Shared context matcher improves worktree/profile granularity; session generation and resolver resource/operation identity remain incomplete. |
| W5 | **Partial/open.** Store and Devices accept profile props; Store remains URL-controlled, Settings target ignores explicit window/deep-link target. |
| W6 | **Open.** Router navigation, malformed payload validation, fabricated generation unchanged. |
| W7 | **Partial/open.** `gitRootId`/`diffPath` reach DiffViewer; retained state and dirty-transition protection absent. |
| W8 | **Partial/open; regression.** Template is reachable from palette, but replacing a populated desktop orphans old windows; app imports remain eager. |
| Prior W9 | **Partial/open.** Disable-purge and cross-profile claim tests added; core mutation/navigation/live-input journeys still absent. |

## Critical issues

### C1 — Changes diff saves still select the ambient server

**Evidence:** `packages/ui/src/os/apps/ChangesApp.tsx:149-160` mounts editable DiffViewer with a qualified target. `packages/ui/src/components/organisms/DiffViewer.tsx:40-45,321-354` still independently resolves `getTransport()` for the stat and write. `packages/ui/src/api/ws-transport.ts:74-84,3323-3344` projects only project/worktree onto the selected socket; a target's profile does not select that socket.

**Impact [INFERENCE]:** owner-A window with ambient B can save to B's matching project/path. Switching ambient ownership between stat and write can redirect the second step. No captured generation checks guard this sequence.

**Correction:** bind both steps to one captured `{profileId,generation}` transport, fail closed when retired, and fence publication after awaits. Fix the canonical shared DiffViewer. The Project Info subfix is good: `ProjectInfoApp.tsx:27-49,108-112` now passes an owner to both config hooks and an explicit panel snapshot; `queries.ts:1185-1208` uses that explicit owner.

### C2 — Qualified Search/Replace still falls back to ambient transport

**Evidence:** profile retention is repaired at `SearchPanel.tsx:48-57,82,146-148`. However, `hooks/use-file-search.ts:119-141` catches failed owner capture and selects ambient transport, then labels returned results with the failed target's profile. `hooks/use-search-panel-replace.ts:148-159,184-202` repeats the fallback for both reads and writes.

`os/apps/SearchApp.tsx:43-51` now selects source profile/project, but uses `match.targetRef?.worktreePath ?? worktreeId` and drops `match.generation`. Federated results deliberately represent their source project root without a worktree (`use-file-search.ts:230-239`): a result from B/root can inherit A's selected worktree.

**Impact [INFERENCE]:** disconnecting A while B remains ambient can read or replace B; stale/mislabelled results can open the wrong generation/worktree. Profile preservation alone does not close this safety finding.

**Correction:** remove qualified-target ambient fallbacks from search and replacement, capture/fence one owner for the operation, and route source target identity without filling an absent source worktree from another context. Reject retired result generations.

## Warnings / required corrections

### W1 — High: catalog consumer registration remains incomplete and delivery is not reliable

Production registration search finds only `FilesApp.tsx:63-80` and five shell handlers (`OsShell.tsx:206-350`): terminal open, file open, browser open, conflict resolve, session review. No production consumer exists for terminal focus, file edit, browser preview, search query, Changes actions, Git actions, workflow selection, ports actions, Project Info/config or Settings/Store intents advertised in `app-registry.ts:3-128`.

- `OsShell.tsx:237-246` reports a file open handled after merely focusing an editor with matching profile/project; it neither compares worktree/file nor updates the requested file/line. `EditorApp.tsx:22-35` reads only its existing path and never consumes line.
- `OsShell.tsx:116-134` creates a destination then dispatches immediately. New Files mounts later and ignores seeded payload, so first-open reveal can be lost. Existing Search/Git/Settings destinations never consume seeded state. Separate deep-link and handler launch paths can also produce duplicate destinations **[INFERENCE]**.
- The reached editor prototype is not a canonical file loader: `MonacoKeepAliveHost.tsx:113-144` creates an empty, nonloading tab with fabricated mtime instead of opening/reading the file. New file-open plumbing does not complete the retained editor/media behavior.
- `GitApp.tsx:28-58,67-71` defines terminal/resolver callbacks but never supplies them to its composed panel.

**Correction:** one owner-qualified launch-and-deliver path, explicit supported-action coverage, actual canonical open/reveal behavior, payload updates for focused destinations, and handling/notice for failed results. Continue-past-unhandled change at `intents.ts:270-292` is correct but insufficient.

### W2 — High: Session Changes still mounts before permission and reinterprets retired identities

`SessionChangesApp.tsx:158-207` mounts the panel when `isLoading === true` because only `!isLoading && !isEnabled` returns early. `useSessionChangesEnabled` intentionally returns disabled during loading (`api/session-changes-queries.ts:306-323`); the canonical host correctly returns early on loading (`SessionChangesHost.tsx:61-64`).

`SessionChangesApp.tsx:27-33` derives generation from the live window provider instead of captured intent identity. `OsShell.tsx:317-345` discards the intent's generation; `app-registry.ts:200-213` also omits it from tuple matching. Disable/explicit-close purges the current owner, but no cleanup captures/purges the previous owner when generation changes or the adapter unmounts (`SessionChangesApp.tsx:74-95`). The new tuple React key does not purge query cache.

**Impact [INFERENCE]:** reads start while config is unresolved; reconnect can reopen the same old review tuple under a new generation and leave old-owner sensitive diffs cached. Minimized/inactive adapters do not observe disable while unmounted.

**Correction:** authoritative loading gate, captured immutable full tuple including generation, and lifecycle cancellation/removal for the retiring owner outside visibility-only adapter lifetime. Preserve the successful disable-purge subfix.

### W3 — High: DOM focus trap and background PTY input gate are absent

`SessionChangesApp.tsx:23-25` focuses once on mount; no `isFocused`/activation dependency, Tab containment, focusin guard or focus-scope primitive exists. Its wrappers only stop bubbling (`:97-104,187-195`); Escape closes unconditionally, without preserving a child widget's consumed/default-prevented Escape. Resolver has only a bubble handler (`ConflictResolverApp.tsx:129-138`).

`TerminalsApp.tsx:46-57` still reattaches on registry events without OS focus checks; `terminal-host-attachment.ts:27,61` schedules focus by default. `TerminalPanel.tsx:821-827` gates input on connection/replay, not actual active OS terminal ownership.

**Impact [INFERENCE]:** Tab or delayed terminal autofocus can put input back into a background live PTY. Review key handlers never see keystrokes targeting xterm.

**Correction:** activation-aware focus scope/containment, suppress background terminal autofocus, dispatch-time PTY owner/focus gate, and Monaco Escape precedence. Prove physical keyboard/paste/IME input produces zero background `terminalWrite` calls.

### W4 — High: matcher improvements do not complete exact instancing/operation contracts

Shared `findExistingWindowForApp` correctly centralizes profile/worktree matching and is reused by shell/palette/Dock. Remaining failures:

- Session tuple comparison omits generation (`app-registry.ts:200-213`; tied to W2).
- Resolver matching includes worktree/operation (`:165-179`), but the actual resource claim still uses only project/root (`ConflictResolverApp.tsx:36-43`), so two worktrees collide.
- Resolver never reads or validates requested `ctx.operation`/`appState.operation`; it composes the current operation returned by the hook (`:21-22,48,67-109`). An unavailable/stale requested operation is not rejected.
- File intent handler bypasses the helper and conflates worktrees/files (`OsShell.tsx:237-246`).

**Correction:** use consistent exact identity in launch, resource claim, and actual controller validation; reject mismatched operations before presenting Apply/Continue/Abort. Add generation and same-profile/two-worktree cases, not only profile-distinct claims.

### W5 — High: management page state remains coupled to global routing/default selections

`AgentStoreApp.tsx:16-23` now supplies profile, but `AgentStorePage.tsx:63-64,98-113,175-179` still reads/writes route search params for tab/profile. Its profile selector writes `profileId` to the URL while `explicitProfileId` always wins (`:80-86`), so it cannot change the pinned app owner and all Store windows share route tabs. No app-state tab is passed or stored.

`SettingsApp.tsx:11-13,47-52` supplies explicit owner only to Devices, not SettingsPage. `SettingsPage.tsx:44-74` keeps independent global target selection and has no explicit intent input. Deep-link `tab` does not match adapter `activeTab`, and singleton reuse never updates target/tab.

**Correction:** extract URL-free reusable content/controller with explicit per-window state/intent input; keep Settings target and preferences-source selectors distinct. Devices' explicit initial-profile prop is useful but does not resolve the whole management contract.

### W6 — Medium: router navigation and untrusted payload validation unchanged

`OsShell.tsx:83-88,137-151` reads browser location in a session-dependent effect and mutates raw history; no router location/navigation identity. Same-route navigation/back-forward need not retrigger consumption. `deep-links.ts:65-78,99-108,215-230` still accepts arbitrary action names, partial/NaN/negative line parsing, unchecked root/operation/URL values, and invents generation `0` rather than validating owner freshness.

**Correction:** basename-aware router-driven idempotent consumption, supported-action/field validation, real owner-tuple freshness and surfaced invalid/unhandled notices. No automatic URL command execution was observed; this does not qualify malformed URL schemes as safe.

### W7 — High: nested diff identity repaired; view and dirty state still discarded

Correct: `ChangesApp.tsx:157-158` now forwards selected `gitRootId` and `diffPath`.

Remaining: `ChangesApp.tsx:20-24,37-54,149-160` retains selection/tab only locally, does not activate Diff after selecting a file, and conditionally unmounts editable DiffViewer without dirty guard. Project Info/Settings local tabs likewise never write window state; Search still uses global `useSearchUiStore` (`SearchPanel.tsx:60-72`). `DesktopCanvas.tsx:40-53,95` unmounts minimized/inactive tab bodies. Persistence allowlists cannot restore state adapters never store.

**Impact [INFERENCE]:** ordinary pane/minimize/desktop transitions reset selection/tab; diff edits can disappear without confirmation.

**Correction:** persist approved view state per window; retain dirty content in canonical memory resources and guard transitions. Preserve nested-root read/save behavioral regressions.

### W8 — High: newly wired template command orphans populated-desktop windows

`CommandPalette.tsx:164-181` replaces the current desktop's whole tree/floating list but retains every old entry in `current.windows`. The template returns only five new placements and clears floats (`desktop-templates.ts:119-125`). Thus any existing nonminimized current-desktop window becomes unplaced; invoking the command again does the same to the first template's windows.

`persistence.ts:493-532` explicitly rejects unplaced nonminimized windows. **Impact [INFERENCE]:** existing windows disappear; saved session can fail validation on reload. Root keep-alive entries can outlive their visible placements. The browser test adds a fresh desktop directly, not this palette command (`os-management-apps.browser.tsx:176-204`), so misses the regression.

**Correction:** use the approved new-project desktop creation flow, or a safe transactional placement-preserving transform; never replace populated placements while retaining unplaced windows. Require valid project context. Also complete planned lazy catalog imports: `OsShell.tsx:6-19` still eagerly imports every feature body, widening `/os` module loading.

### W9 — High: reported passing checks do not exercise the failed contracts

Good additions: disabled-cache removal (`os-review-apps.browser.tsx:222-265`) and profile-distinct claims (`:267-317`). However, the purported input-trap test still dispatches synthetic Escape directly to the wrapper and only checks window event bubbling (`:204-219`); its `terminalWrite` spy is never asserted and no live background terminal participates. Config preloading avoids the authoritative-loading case. Workspace tests assert adapter mounting and handler status, not actual file content/navigation (`os-workspace-apps.browser.tsx:108-194`).

**Correction:** focused regressions for owner-distinct config/diff/replace transports; generation retirement during awaits; first-open and existing-destination delivery; same-route/back-forward; two worktrees; loading/disconnect/retiring cache cleanup; real focus/PTy writes; dirty nested-root transitions; repeated palette template application. No coverage percentage is available.

### W10 — High: per-profile Ports window still renders aggregate ports and relabels browser handoff

`PortsTunnelsApp.tsx:12-25,39` captures the window profile only for browser intent, supplying no owner/filter to PortsPanel. `PortsPanel.tsx:595-609` invokes `usePorts()` without options; `hooks/use-ports.ts:118-130` selects all registered profiles. Rows correctly target their own profile for tunnel/kill operations (`PortsPanel.tsx:675-683`), but the adapter's browser callback ignores the tunnel and labels every URL with its window's profile.

**Impact [INFERENCE]:** A-scoped window can show/control B ports, and B's Browser handoff is labeled A; multiple per-profile windows duplicate aggregate subscriptions/rendering.

**Correction:** thread explicit owner/profile through canonical PortsPanel/usePorts for OS composition, and retain entry ownership through browser handoff. Preserve aggregate behavior only for its existing deliberate aggregate entry point.

## Suggestions / positive observations

- Keep the useful small adapters and canonical feature bodies; do not build a second feature-controller layer to patch delivery.
- Type manifest intents as supported `IntentAction` values, preferably sharing executable coverage metadata; unrestricted strings currently conceal consumer gaps.
- Remove dead callbacks from GitApp by actually wiring the intended cross-actions. Reuse the canonical resolver composition/controller instead of two inventories and inert toolbar callbacks (`ConflictResolverApp.tsx:149,151`).
- Keep strict persistence projection: resolver/session payloads remain omitted by default (`persistence.ts:38-98`). Add explicit regression tests for sensitive app-state exclusion; do not serialize drafts to solve view retention.
- No server endpoints/dependencies added in the reviewed change set. Known-profile rejection and explicit Project Info ownership are improvements. Router continuation after nonmatching handlers and nested-root diff props are correct local fixes.

## Reviewed files

Paths below under `packages/ui/` unless stated otherwise; large supporting files inspected in targeted sections.

- Production: `src/os/{OsShell.tsx,CommandPalette.tsx,Dock.tsx,types.ts,app-registry.ts,intents.ts,persistence.ts,deep-links.ts,desktop-templates.ts}`.
- All Phase 05 adapters: `src/os/apps/{FilesApp,SearchApp,ChangesApp,ProjectInfoApp,GitApp,ConflictResolverApp,SessionChangesApp,WorkflowPlansApp,PortsTunnelsApp,AgentStoreApp,SettingsApp}.tsx`.
- Shared modifications: `src/components/organisms/SearchPanel.tsx`, `src/components/pages/{AgentStorePage,SettingsPage,DevicesPage}.tsx`, `src/embed/dam-hopper-app.tsx`.
- Supporting boundaries: `src/os/{window-context.tsx,window-store.ts,DesktopCanvas.tsx,OsResourceHost.tsx,MonacoKeepAliveHost.tsx}`, `src/os/apps/{EditorApp,BrowserApp,TerminalsApp}.tsx`, `src/api/{queries.ts,session-changes-queries.ts,ws-transport.ts}`, `src/hooks/{use-file-search.ts,use-search-panel-replace.ts,use-ports.ts}`, `src/components/organisms/{DiffViewer.tsx,SessionChangesHost.tsx,PortsPanel.tsx,TerminalPanel.tsx}`, `src/lib/{terminal-host-attachment.ts,search-matches.ts}`; targeted window-ops search.
- Tests: `src/os/{app-registry,deep-links}.test.ts`, `browser-tests/{os-workspace-apps,os-review-apps,os-management-apps}.browser.tsx`.
- Requirements/evidence: `README.md`, `docs/{project-overview-pdr,code-standards}.md`, `plans/261101-1738-ai-dev-os-redesign/phase-05-app-migration-and-intents.md`, Cycle 1 review and Cycle 2 final tester receipt.

## Validation commands / results

Reviewer executed source inspection only (`git status --short`, `git diff --stat`, targeted `git diff`, read/search). No reviewer build/test/lint execution; avoid duplicate execution owned by the tester/main agent.

The following are **tester-reported**, not independently rerun: `plans/reports/tester-261102-1438-phase-05-cycle-2-final.md:13-20,26-60`.

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os` | Exit 0; 9 files, 59 tests passed, no skips. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files, 9 tests passed, no skips; three diagnostic repeats also reported passing. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 type errors. Not a production Vite bundle build. |

Receipt notes nonfatal React `act(...)` warnings and a prior initial-cycle fixture race, subsequently addressed by config seeding. Lint, test coverage percentage, type-coverage percentage, real PTY/server/browser-security journeys and production bundle performance not measured in this review. Passing mount/shape tests do not contradict static dataflow failures above.

## Recommended disposition

Do not accept Phase 05 as behaviorally complete. First close C1/C2, then authoritative review lifecycle/input isolation and reliable context-qualified delivery. Fix invalid template publication and complete management/Ports ownership and retained-state journeys. Main should run joined validation after corrections; reviewer did not edit plan/task status per assignment ownership.

## Unresolved questions

- Live PTY focus/input, stale-owner mutation and browser URL-scheme behavior remain unexercised; exact runtime consequences beyond the static paths are unqualified.
- Production `/os` bundle size/load effect remains unmeasured; eager import violation is established by source, not a benchmark.
- No missing product decision blocks correction: owner, instancing, lifecycle, URL and template requirements are already specified in the phase plan.
