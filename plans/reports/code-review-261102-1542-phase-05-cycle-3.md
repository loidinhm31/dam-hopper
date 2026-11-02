# Code Review — Phase 05 application catalog and deep links, Cycle 3

## Overall assessment

**Score: 5/10 — request changes.** The direct DiffViewer ambient-save defect is repaired. Qualified project search/replace no longer catches owner-capture failure and silently selects ambient transport; SearchApp no longer borrows the window worktree for a source-root result. The destructive template replacement is also repaired. However, several claimed Cycle 3 corrections are absent from the inspected source: existing-window payload delivery, captured review generation, actual focus trapping, generation-aware tuple matching, resolver claim identity, and URL-independent Agent Store composition.

Method: source/diff review with the published `code-review` skill; security, ownership, async lifecycle, feature reachability, architecture, performance, KISS/DRY/YAGNI and regression-test relevance. Inspected all Phase 05 modified/new production files and five new test files, plus targeted supporting controllers/resources. Approximately 6,000 lines of targeted source/test sections; not a whole-repository security audit. Runtime consequences not exercised here are marked **[INFERENCE]**. No source or plan/task-state edits; this report is the only authored artifact. Plan remains incomplete, consistently with its pending acceptance gates.

## Resolution ledger

| ID | Cycle 3 result |
| --- | --- |
| C1 | **Direct ambient-save defect resolved.** One transport from `getConnectionTransport(snapshot.owner)` handles stat and write. Disconnected qualified profiles throw. Post-await publication fencing is still incomplete; see W0. |
| C2 | **Partial.** Qualified project-mode search and replacement capture failures no longer fall back; exact result worktree absence is preserved. Workspace-mode ambient fallback and retired-result generation handling remain; see W0. |
| W1 | **Partial/open.** Five shell consumers exist, but existing windows still only receive focus, most declared actions remain unhandled, and first-open delivery races remain. |
| W2 | **Partial/open.** Disable/explicit-close cache purge and full panel React key exist. Loading gate, captured generation and retiring-owner cleanup remain absent. |
| W3 | **Open.** One `.focus()` on mount is not a focus trap or active-window PTY input gate. |
| W4 | **Partial/open.** Worktree/profile instance matching is correct; tuple matcher still omits generation and resolver claims still omit worktree/operation. |
| W5 | **Partial/open.** Explicit profile props exist. Agent Store still reads/writes global route params; Settings ignores explicit target/tab. |
| W6 | **Open.** Router navigation identity, payload validation and real review-generation validation unchanged. |
| W7 | **Partial/open.** Nested diff root/path are forwarded, but retained view/dirty-state handling remains incomplete. |
| W8 | **Destructive replacement resolved.** Palette appends and activates a newly identified desktop while preserving old desktops/windows. Project-context gate and planned lazy app loading remain incomplete. |
| W9 | **Open.** Current tests do not establish mutation, real keyboard/PTy isolation, navigation, retirement or existing-destination behavior. |
| W10 | **Partial/open.** Non-default Ports profile filtering reaches `usePorts`; default drops qualification, installer is still ambient, tunnel callback lacks authoritative source metadata. |

## Critical issues

No additional Critical-severity exploit or cross-profile DiffViewer save path established in this cycle. Do not mistake this for acceptance: high-priority stale-owner, input-isolation and feature-delivery failures remain below. C1/C2's repaired local paths are not proof of complete owner-generation safety.

## Warnings / required corrections

### W0 — High: completed owner-routing fixes still do not fence retired data and completion publication

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:43-58,334-396` now captures one qualified transport, fixing C1's direct routing defect. It does not retain the captured owner for checks after stat/write or verify the current file/target before assigning `savedContentRef`, clearing dirty state and invalidating queries. `api/connections.ts:646-667` validates only when retrieving the transport; it returns the raw transport, not an operation-wide generation fence. Real transport destruction rejects pending WS requests (`api/ws-transport.ts:2277-2308`), which is useful protection, but does not make every already-resolved completion current.

`hooks/use-file-search.ts:95-144` omits generation from project-mode query keys and does not recheck `conn` after `invoke`. SearchApp drops `match.generation` (`os/apps/SearchApp.tsx:42-54`). Both replacement modes capture the current connection from profile ID rather than reject the selected match's retired generation (`hooks/use-search-panel-replace.ts:136-204,300-350`). Workspace search still unconditionally selects ambient transport when no eligible profiles exist (`use-file-search.ts:147-161`), even when the supplied target is qualified; those results have no source-owner enrichment.

**Impact [INFERENCE]:** cached/late old-generation search results can reopen or authorize replacement against a fresh owner generation. Late DiffViewer completion can mark changed view state clean. The remaining workspace fallback violates the explicit-target fail-closed contract when its ambient client is usable. Original project-mode ambient fallbacks and source-worktree borrowing are fixed; do not reintroduce them.

**Correction:** include captured generation in result/cache/action identity, reject retired matches before open/replace, keep one operation owner and transport, and check current owner plus current target/edit identity before completion publication. Permit ambient workspace search only for a genuinely unqualified legacy entry point. Add owner-distinct and retirement-during-await regressions.

### W1 — High: registering consumers has not completed launch-and-deliver

**Evidence:** `OsShell.tsx:206-350` registers the five named handlers. Existing editor (`:237-246`), resolver (`:294-297`) and session-review (`:327-330`) branches only restore/focus; none updates appState. Repository search finds `updateAppState` only at its declaration/implementation (`window-store.ts:84,261-279`), with zero consumers. File matching ignores worktree/file. Resolver initial selection is mount-only (`ConflictResolverApp.tsx:22,51-53`). `EditorApp.tsx:22-35` never consumes line.

The deep-link effect opens a destination and immediately dispatches (`OsShell.tsx:104-135`), before newly mounted Files registers its reveal handler; Files ignores seeded appState (`FilesApp.tsx:19,63-80`). Terminal/browser handlers always open another window, so the deep-link pre-open plus dispatch can produce duplicates **[INFERENCE]**. Only Files and the five shell handlers register production consumers; Search/Git/Changes/Workflow/Settings/Store and other advertised actions remain unsupported.

The file-open destination still reaches prototype loading: `MonacoKeepAliveHost.tsx:113-144` creates an empty, nonloading tab with fabricated mtime rather than reading the file. `TerminalsApp.tsx:18-20` consumes sessionId, while shell terminal-open seeds only cwd. Git's terminal/resolver callbacks remain unused (`GitApp.tsx:28-58,67-71`).

**Impact [INFERENCE]:** handled status can mean wrong file/worktree, ignored line or reveal, duplicate window, or blank file/terminal instead of retained functionality.

**Correction:** one context-qualified launch/delivery path; deliver fresh payloads to reused windows and make adapters consume them reactively. Mount/read real canonical feature controllers. Exercise new and existing destination journeys, not handler status alone.

### W2 — High: Session Changes still reinterprets generation and mounts while config loads

**Evidence:** `SessionChangesApp.tsx:27-33` derives owner generation from the live provider, not the captured intent. Shell appState omits generation (`OsShell.tsx:340-345`); matcher omits it (`app-registry.ts:200-213`). The loading check `!isLoading && !isEnabled` (`SessionChangesApp.tsx:158`) allows the panel to mount during loading, unlike the canonical authoritative gate (`SessionChangesHost.tsx:61-64`).

Disable and explicit close correctly cancel/remove current-owner queries (`SessionChangesApp.tsx:74-95`), and panel key includes the full live tuple (`:198-204`). There is no cleanup for the captured retiring owner, invalidation subscription or unmount cleanup. Minimized/inactive bodies unmount (`DesktopCanvas.tsx:40-53,95`), so their adapter effects cannot continuously observe retirement/disable.

**Impact [INFERENCE]:** old review identity can be rebound on reconnect, old-generation sensitive cache can remain, and reads start before authoritative enablement.

**Correction:** preserve immutable captured generation end-to-end; gate panel on `!isLoading && isEnabled` and exact live tuple; place close/purge lifecycle outside visibility-only adapter lifetime and retire the original owner, not the replacement generation.

### W3 — High: Session Changes has mount focus, not focus containment or PTY isolation

**Evidence:** `SessionChangesApp.tsx:23-25` calls focus once. No Tab containment, focus scope, focusin redirection or activation-aware focus exists. Bubble handlers (`:97-104,187-195`) only intercept keys already targeting the review. Escape ignores a child's `defaultPrevented` status.

`TerminalsApp.tsx:40-61` reattaches on registry events without OS-focus checks; attachment defaults to scheduled focus (`lib/terminal-host-attachment.ts:27,61`). Actual PTY input checks connection/replay, not active OS ownership (`TerminalPanel.tsx:821-827`).

**Impact [INFERENCE]:** Tab or delayed terminal autofocus can put input into a background live PTY; review bubbling cannot intercept input whose target is xterm.

**Correction:** activation-aware containment and Escape precedence; suppress background terminal autofocus and gate dispatch-time keyboard/paste/IME writes by active owner/window. Prove zero background `terminalWrite` calls with a real focusable terminal surface.

### W4 — High: resolver claim and requested-operation validation remain incomplete

**Evidence:** worktree/profile matching is correctly centralized (`app-registry.ts:159-197`). Session tuple generation is still absent (`:200-213`). `ConflictResolverApp.tsx:36-43` claims `${project}:${root}` without worktree or operation. It never reads the requested operation and exposes controls for whatever the current resolver hook returns (`:21-22,48,67-109,141-155`).

**Impact [INFERENCE]:** two worktrees collide in resource claims despite matching separate windows; a stale requested operation can present controls for a different active operation.

**Correction:** identical exact identity in matching, resource claims and controller validation; reject unavailable/mismatched requested operations before Apply/Continue/Abort. Test same profile/project/root with two worktrees and two generations.

### W5 — High: management composition is not URL-independent or target-delivered

**Evidence:** AgentStorePage accepts explicit profile but still parses route state (`AgentStorePage.tsx:63-64`), writes it on profile/tab changes (`:98-113`) and reads `location.tab` for content (`:175-179`). Explicit profile wins forever (`:80-86`), so its selector changes the global URL without changing its own pinned owner. All Store windows share route tab state. Devices uses explicit profile only to initialize local state (`DevicesPage.tsx:22-24`); later prop changes are ignored.

`SettingsApp.tsx:11-13,47-52` supplies target only to Devices. SettingsPage continues to select the global Settings target (`SettingsPage.tsx:44-74`). Parser supplies `tab`, adapter expects `activeTab`, and singleton reuse never delivers target/tab.

**Correction:** URL-free controlled canonical page composition for OS windows; legacy routes may adapt URL state to those same props. Keep target-server and preferences-source selections distinct. Deliver requested Settings target/tab deliberately rather than assuming the window provider scopes an ambient controller.

### W6 — Medium: deep-link navigation and input validation remain insufficient

**Evidence:** `OsShell.tsx:83-151` uses global browser search/raw `replaceState`, not router location/navigation identity. Same-route navigation and back/forward do not reliably trigger consumption. `deep-links.ts:65-78` accepts any action string, `:100-108` accepts partial/NaN/negative line numbers and unchecked fields, and `:223-230` invents generation 0 rather than validate the owner tuple.

**Impact [INFERENCE]:** ignored/repeated navigation, accepted malformed requests and stale review launch. No automatic command execution or exploitable URL-scheme execution was established by this review.

**Correction:** basename-aware router-driven idempotent consumption, typed supported-action/field validation, real tuple freshness and surfaced unavailable/unhandled results.

### W7 — High: view persistence allowlists are not connected to adapters; dirty diff can disappear

**Evidence:** `ChangesApp.tsx:20-24,37-54,149-160` retains selection/tab locally, does not activate Diff upon file selection, and unmounts editable DiffViewer without a dirty transition guard. Project Info/Settings likewise keep tabs locally. Search uses global search UI state (`SearchPanel.tsx:60-72`), not per-window state. `updateAppState` has zero callers. `DesktopCanvas.tsx:40-53,95` unmounts minimized/inactive bodies.

**Impact [INFERENCE]:** normal tab/minimize/desktop transitions reset views or discard unsaved diff edits. Persistence cannot restore data never written to window state.

**Correction:** persist approved view state per window; keep drafts only in canonical memory resources and guard dirty transitions. Preserve the correct `gitRootId`/`diffPath` forwarding (`ChangesApp.tsx:157-158`).

### W8 — Medium residual: template publication repaired; context gate and lazy loading still absent

**Resolved evidence:** `CommandPalette.tsx:161-181` generates a new desktop ID, appends desktop/windows and activates it without replacing existing placements. The previous orphan-window defect is closed by source inspection.

**Remaining:** `:163-168` still permits project templates with no project, yielding project-required windows with empty contexts. `OsShell.tsx:6-19` eagerly imports all app bodies despite the planned lazy catalog imports. **Impact [INFERENCE]:** unusable project desktop and unnecessary initial module loading; bundle cost not measured.

**Correction:** require valid project context and implement the planned lazy catalog loading using existing patterns. Test the actual palette command repeatedly on a populated desktop; current management test bypasses it.

### W9 — High: test scope does not support complete safety/feature claims

**Evidence:** `os-review-apps.browser.tsx:158-219` calls synthetic Escape on the wrapper and checks event bubbling, not real Tab/focus/paste/IME or any `terminalWrite` assertion. Fixture preloads enabled config (`:82-88`), bypassing loading. Claim test varies profiles, not worktrees/operations/generations (`:267-317`). Workspace tests assert mount/handler status, not loaded file/line/navigation (`os-workspace-apps.browser.tsx:108-194`). Template browser test constructs/appends a desktop itself rather than exercising the palette (`os-management-apps.browser.tsx:176-204`). Registry tests' purported full tuple has no generation (`app-registry.test.ts:156-170,233-259`).

**Correction:** meaningful regressions for the exact failure paths above. Passing mount/shape tests and a clean typecheck do not contradict these dataflow failures.

### W10 — High: Ports filtering does not qualify every retained operation

**Resolved:** `PortsTunnelsApp.tsx:46-48` forwards non-default profile through `PortsPanel.tsx:595-611` to `usePorts({profileId})`; ordinary row actions use entry profile.

**Remaining:** adapter converts `default` to undefined, which selects aggregate profiles (`use-ports.ts:118-130`). Cloudflared installation still captures ambient transport (`use-ports.ts:80-82,348-370`); the explicit profile does not scope installation/progress. Browser callback probes `tunnel.profileId` (`PortsTunnelsApp.tsx:18-24`), but `TunnelInfo` has no such field (`api/client.ts:288-299`); PortsPanel forwards the raw tunnel, not `entry.profileId` (`PortsPanel.tsx:390-394`), and usePorts stores ownership on the enclosing PortEntry (`use-ports.ts:188-209`).

**Impact [INFERENCE]:** A-scoped Ports installer can run on ambient B; default-scoped window can aggregate other owners and relabel Browser handoff. Non-default filtered row handoff is correct only because every row currently shares the window profile, not because tunnel source identity is preserved.

**Correction:** thread actual owner through installer/progress and preserve row owner in Browser callback; never strip a qualified default into aggregate semantics. Preserve aggregate behavior only at deliberate legacy aggregate entry points.

## Suggestions / positive observations

- Keep small adapters and canonical feature bodies. Do not add a second controller framework to solve missing delivery.
- Use the existing `updateAppState` only with real consuming adapters; currently the API and persistence projections are unused scaffolding.
- Type manifest actions as supported intent actions; unrestricted strings hide advertised-but-unimplemented coverage.
- Keep sensitive resolver/session payloads excluded from persistence. Do not solve draft retention by serializing content.
- Remove inert Git callbacks/toolbar no-ops by wiring intended canonical actions, not by suppressing diagnostics.
- Positive: C1 captures one transport, qualified project search/replace now fail closed on capture error, SearchApp preserves absent source worktree, nested-root diff props are forwarded, shared instance matching is reused, router continues past nonmatching handlers, and palette now preserves old desktop placements. No backend endpoints or dependencies added in this change set.

## Reviewed files

All paths below relative to `packages/ui/` unless stated otherwise; large supporting files inspected in targeted sections.

- Modified production: `src/components/organisms/{DiffViewer,PortsPanel,SearchPanel}.tsx`; `src/components/pages/{AgentStorePage,DevicesPage,SettingsPage}.tsx`; `src/embed/dam-hopper-app.tsx`; `src/hooks/{use-file-search,use-search-panel-replace}.ts`; `src/os/{CommandPalette,Dock,OsShell}.tsx`; `src/os/{app-registry,intents,persistence,types,window-store}.ts`.
- New production: `src/os/{deep-links,desktop-templates}.ts`; all eleven `src/os/apps/{AgentStoreApp,ChangesApp,ConflictResolverApp,FilesApp,GitApp,PortsTunnelsApp,ProjectInfoApp,SearchApp,SessionChangesApp,SettingsApp,WorkflowPlansApp}.tsx`.
- Supporting: `src/os/{window-context,DesktopCanvas,MonacoKeepAliveHost,OsResourceHost}.tsx`; `src/os/apps/{EditorApp,TerminalsApp,BrowserApp}.tsx`; `src/api/{connections,session-changes-queries,queries,client,ws-transport}.ts`; `src/hooks/use-ports.ts`; `src/lib/{search-replace-next,terminal-host-attachment}.ts`; `src/components/organisms/{SessionChangesHost,TerminalPanel}.tsx`.
- Tests: `src/os/{app-registry,deep-links}.test.ts`; `browser-tests/{os-workspace-apps,os-review-apps,os-management-apps}.browser.tsx`.
- Requirements/evidence: root `README.md`; `docs/{project-overview-pdr,code-standards}.md`; `plans/261101-1738-ai-dev-os-redesign/phase-05-app-migration-and-intents.md`; prior Cycle 2 review and final tester receipt; published development rules/primary workflow/code-review skill.

## Validation commands / results

Reviewer executed source inspection (`git diff --stat`, `git status --short`, targeted `git diff`, read/search). **No reviewer builds, tests, lint or production bundle execution.** Phase plan explicitly assigns joined validation to main; no duplicate runs or live writes performed. No Cycle 3 pass claim.

Latest inspected receipt is **Cycle 2**, reported by tester, not independently rerun and not validation of current Cycle 3 edits: `plans/reports/tester-261102-1438-phase-05-cycle-2-final.md:13-20,26-60`.

| Command | Historical reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os` | Exit 0; 9 files, 59 tests passed. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files, 9 tests passed; three repeats reported passing. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript `tsc -p tsconfig.json`, not production Vite bundling. |

Main should run phase-listed unit/browser/parity suites and UI typecheck after corrections join, adding behavior coverage for findings rather than merely rerunning mounting tests. Historical receipt notes nonfatal React `act(...)` warnings. Current type-coverage percentage, test-coverage percentage, lint issue count, live PTY safety, and production bundle cost are **not measured**.

## Unresolved questions

- Current Cycle 3 joined validation receipt was not available in inspected evidence; historical Cycle 2 results cannot certify the new edits.
- Physical keyboard/paste/IME with a background PTY, retirement during mutation, same-route/back-forward delivery and URL-scheme behavior remain unexercised. Runtime impacts above remain explicitly inferred.
- No unresolved product decision blocks the corrections: exact ownership, lifecycle, retained feature behavior and template requirements are specified in the phase plan.
