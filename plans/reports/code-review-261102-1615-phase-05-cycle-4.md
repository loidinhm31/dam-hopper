# Code Review — Phase 05 application catalog and deep links, Cycle 4

## Overall assessment

**Score: 5/10 — request changes. Phase 05 acceptance not established.** Several repairs are present, but the claim that C1/C2 and all warnings are resolved does not match inspected source. The direct DiffViewer cross-profile transport defect and destructive desktop replacement are fixed. Canonical editor opening, more shell consumers, resolver claim fields, an initial generation ref, loading gate and child Escape precedence are improvements. End-to-end generation preservation, complete action delivery, reliable input isolation and management ownership still have high-priority defects.

Method: published `code-review` skill, source/diff review against Phase 05 and ownership standards. Approximately 5,500 targeted source/test/documentation lines; not a whole-repository audit. Runtime consequences not exercised by reviewer are labeled **[INFERENCE]**. No implementation or plan/task-state edits; this report is the only authored artifact. Plan status remains pending, consistent with unresolved acceptance. Joined validation belongs to main/tester under the phase's explicit ownership contract.

## Resolution ledger

| ID | Cycle 4 result |
| --- | --- |
| C1 | **Direct transport routing resolved; completion safety incomplete (W0).** One qualified transport handles stat and write. |
| C2 | **Partial.** Qualified project-mode capture failures no longer fall back; SearchApp preserves exact source worktree absence. Workspace fallback and generation rebinding remain (W0). |
| W0 | **Open/high.** Save revision is not invalidated on identity/edit/unmount; captured generation is not compared; no post-write connection fence. Search/replacement still accept retired matches. |
| W1 | **Partial/high.** More consumers and `updateAppState` calls exist, and editor invokes canonical `open()`. Many catalog actions remain unregistered; adapters ignore delivered state; first-open/deep-link races remain. |
| W2 | **Partial/high.** Loading gate and mounted generation-retirement effect added. Shell drops captured generation; hidden/remounted review can rebind; offscreen lifecycle purge remains absent. |
| W3 | **Partial/high.** Child `defaultPrevented` Escape respected; boundary Tab code exists. Cold-load initial focus, true tabbable containment, activation and dispatch-time PTY gate remain absent. |
| W4 | **Partial/high.** `WindowContext.generation` exists; resolver claim includes worktree/operation. Tuple matcher still ignores generation; requested operation is not validated. |
| W5 | **Partial/high.** Explicit profile props exist. URL-coupled Agent Store, stale Devices props and ignored singleton Settings target/tab remain. |
| W6 | **Open/medium.** Raw browser navigation, malformed field acceptance and fabricated session generation unchanged. |
| W7 | **Open/high.** Dirty diff/view state remains local and unmountable; persistence projections are not connected to consuming adapters. |
| W8 | **Destructive replacement resolved.** New desktop is appended/activated. Residual context validation and lazy imports remain medium priority. |
| W9 | **Open/high.** Current tests do not exercise the safety/feature claims they are being used to close. |
| W10 | **Partial/high.** Installer request now selects a bound transport, but stale closure/progress/default qualification and authoritative row-source callback remain unresolved. |

## Critical issues

**None established at Critical severity.** This is not approval: multiple High ownership, data-loss and PTY-isolation risks remain. No new backend endpoint, authentication bypass or exploitable injection path established by this review.

## Warnings / required corrections

### W0 — High: save/search/replacement fencing remains incomplete

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:48-58,168,202-207,335-411` obtains one transport for stat/write. However, `saveRevisionRef` changes only when starting another save, not on file/target change, edits or unmount. After stat it checks only that *some* generation of the profile is connected; after write it checks no connection identity. Catch/error publication is unfenced too. `api/connections.ts:646-667` returns the raw transport after a retrieval-time check, not an operation-wide fence.

**Impact [INFERENCE]:** save A completes after switching to B, mutating B's dirty/error state; editing during a save can be marked clean despite newer unsaved content. A reconnect can pass the status-only check. Same-transport use fixes routing, not current-view publication.

`hooks/use-file-search.ts:95-161` omits generation from project query keys and does not check its captured owner after project search. Workspace mode still uses ambient transport whenever eligible profiles are empty, even with an explicit target. `os/apps/SearchApp.tsx:42-52` correctly preserves `match.targetRef?.worktreePath`, but drops `match.generation`. `hooks/use-search-panel-replace.ts:136-204,300-356` captures a *new* connection for old matches, and Replace Next captures separately for read and write.

**Impact [INFERENCE]:** retired matches can open/replace on a fresh owner generation; qualified workspace failure can read through another ambient owner.

**Correction:** retain one `{owner, transport}` operation snapshot; revalidate exact owner and view/edit identity before every state publication and write; invalidate revision on relevant lifecycle changes. Include generation in search cache/result/action identity, reject retired matches and reuse the same replacement transport through read/write. Permit ambient fallback only for deliberate unqualified legacy callers. Confidence: high.

### W1 — High: catalog consumers and payload delivery are still incomplete

**Evidence:** `os/app-registry.ts:11-128` advertises terminal focus, file edit, browser preview, search query, Changes actions, Git diff/history/branch, conflict reveal, workflow plan, tunnel browser, project config and Settings devices. `os/OsShell.tsx:209-580` does not register these; repository handler search finds only Files' reveal in adapters. Deep-link Git hash also emits unhandled `git:reveal-commit` (`deep-links.ts:186-194`).

The editor now calls canonical `useEditorStore.open()` (`OsShell.tsx:240-254`), fixing ordinary intent-open reads; `EditorApp.tsx:22-35` still ignores line. Delivered resolver file selection is mount-only (`ConflictResolverApp.tsx:62-76`). Workflow's `selectedItemId`, Agent Store's `tab` and Settings' updated `activeTab` do not reach reactive canonical consumers (`WorkflowPlansApp.tsx:44-55`, `AgentStoreApp.tsx:16-23`, `SettingsApp.tsx:10-13`). Terminals still expects `sessionId`/uses a synthetic default, whereas terminal-open seeds only cwd (`TerminalsApp.tsx:18-20`, `OsShell.tsx:212-228`).

Deep-link effect pre-opens then dispatches before new adapters mount and before initial shell registration (`OsShell.tsx:85-154,209`). Files ignores seeded payload (`FilesApp.tsx:19,63-80`). Terminal/browser handlers unconditionally open another window. **Impact [INFERENCE]:** ignored requests, duplicate windows, wrong selection, or empty terminal despite a handled result.

**Correction:** one launch-and-deliver path with current store state and reactive adapter consumption; register every retained advertised action or remove unsupported advertising only with approved scope change. Await/report canonical opening failure, implement line reveal and retained terminal controller composition. Exercise new and reused destinations. Confidence: high.

### W2 — High: captured session generation is lost before the new ref can preserve it

**Evidence:** `SessionChangesApp.tsx:27-40` freezes generation for one component lifetime and now gates loading (`:205-219`), both positive. But shell session-open copies neither `intent.payload.generation` into ctx nor appState (`OsShell.tsx:346-380`). Consequently it freezes the live provider generation instead. `WindowContext.generation` exists (`types.ts:19-25`) but tuple matching never compares it (`app-registry.ts:200-213`). Deep-link parser invents generation 0 (`deep-links.ts:223-230`).

Review close/purge effects live only inside the mounted adapter (`SessionChangesApp.tsx:81-114`); minimized/inactive bodies unmount (`DesktopCanvas.tsx:40-53,95`; `OsShell.tsx:718-723`). No adapter unmount cleanup retains/purges the original owner.

**Impact [INFERENCE]:** stale direct intent is reinterpreted as current; a hidden review restored after reconnect captures the replacement generation; hidden windows do not observe disable/retirement and old sensitive cache can remain. Deep links and direct intents have inconsistent generation behavior.

**Correction:** preserve and validate immutable generation end-to-end; require exact tuple including generation; place close/purge owner lifecycle outside visibility-only bodies. Never infer a review generation from mount time. Confidence: high.

### W3 — High: boundary Tab handling is not reliable focus/PTy isolation

**Evidence:** `SessionChangesApp.tsx:23-25` focuses only once; its ref is attached only to the enabled branch (`:248-250`), not loading/incomplete/unavailable/claim-denied branches. Cold loading therefore runs the effect with null ref and never focuses when enabled. Its selector (`:129-131`) includes disabled/hidden controls and negative-tabindex buttons. Wrapping to a disabled first/last control prevents default but cannot move focus. There is no focusin/activation recovery or background-terminal dispatch gate. Child Escape precedence is now correct (`:119-123`).

`TerminalsApp.tsx:40-61` still attaches with default focus on registry changes; `terminal-host-attachment.ts:27,61` schedules autofocus. `TerminalPanel.tsx:821-827` gates connection/replay, not active OS window/review ownership.

**Impact [INFERENCE]:** cold opening or delayed terminal autofocus can leave keyboard/paste/IME targeting a live background PTY; wrapper event propagation cannot stop events targeted at xterm.

**Correction:** activation-aware focus containment using actual enabled visible tabbables, correct root refs and loading-to-ready focus; suppress background autofocus and gate terminal writes at dispatch by active ownership. Prove zero writes with a real focusable terminal surface. Confidence: high.

### W4 — High: resolver identity includes fields but does not enforce requested operation

**Evidence:** `ConflictResolverApp.tsx:36-57` now includes worktree and operation in resource claim. However it prefers the *live* resolver operation over the requested operation and never rejects a mismatch. Continue/Abort call live resolver methods (`:78-120`); toolbar/editor mount for that operation (`:152-167,210-221`).

**Impact [INFERENCE]:** a stale merge request can present mutation controls for a different current operation. Updated filePath on a reused window also remains unconsumed (W1). Generation-aware session tuple match remains missing (W2).

**Correction:** fail closed on unavailable/mismatched requested operation before mounting mutation-capable editor/toolbar; use consistent exact identity for matching, claims and controller validation. Confidence: high.

### W5 — High: management props do not create URL-independent, target-delivered apps

**Evidence:** `AgentStorePage.tsx:63-64,98-113,175-179` still reads/writes global route params for profile/tab even when explicitly scoped. Explicit profile wins over selector changes (`:80-86`), so selection can modify URL without modifying its own pinned owner. AgentStoreApp ignores delivered tab and strips default qualification (`:16-23`). Devices uses explicit profile only for initial state (`DevicesPage.tsx:22-24`).

Settings singleton reuse updates tab only, not requested target (`OsShell.tsx:474-488`); SettingsApp reads tab only on mount and supplies no owner to SettingsPage (`SettingsApp.tsx:10-13,47-52`). SettingsPage still uses global Settings selection (`SettingsPage.tsx:44-79`). Deep-link payload `tab` differs from adapter `activeTab`.

**Impact [INFERENCE]:** cross-window tab coupling, ineffective profile selectors and settings/device actions shown for a target different from the requested one.

**Correction:** controlled URL-free canonical composition with explicit target/tab change callbacks; legacy route adapter may translate URL to those props. Reactively deliver singleton requests while retaining independent target-server and preferences-source selection. Confidence: high.

### W6 — Medium: deep-link navigation and validation remain insufficient

**Evidence:** `OsShell.tsx:85-154` observes raw `window.location.search`, not router navigation identity; clears via raw replaceState, discards hash/search and dispatch outcome. Same-route/back-forward navigation is not an effect dependency. `deep-links.ts:65-78` accepts arbitrary action strings; `:100-108` permits partial/negative/NaN line values and unchecked fields; `:223-230` fabricates review generation.

**Impact [INFERENCE]:** ignored/repeated navigation, accepted malformed requests and silent unhandled destinations. No executable URL-scheme exploit or automatic command execution established.

**Correction:** basename-aware router-driven idempotent consumption; validate supported actions/typed fields and real owner freshness; surface unavailable/unhandled outcomes. Confidence: high for source defects; navigation effects inferred.

### W7 — High: dirty diff and approved view state can still disappear

**Evidence:** `ChangesApp.tsx:20-24,37-54,95-160` stores selection/tab locally, does not switch to Diff on selection, and unmounts editable DiffViewer on tab change without dirty guard/resource retention. Desktop visibility transitions also unmount it (`DesktopCanvas.tsx:40-53,95`). Project Info and Settings tabs remain local; Workflow/Agent Store delivered state is ignored (W1/W5). Added persistence allowlists cannot persist state that adapters never publish/consume.

**Impact [INFERENCE]:** unsaved diff edits disappear on ordinary tab/minimize/desktop transitions; restored windows lose requested view state.

**Correction:** persist approved per-window views; retain drafts in canonical memory resources and guard dirty transitions, not localStorage content. Keep correct nested-root `gitRootId`/`diffPath` forwarding (`ChangesApp.tsx:157-158`). Confidence: high.

### W8 — Medium residual: template preserves placements, but context/lazy-loading acceptance remains

**Resolved:** `CommandPalette.tsx:161-181` appends a new uniquely identified desktop/windows and activates it without replacing existing placements.

**Remaining:** same handler permits missing project (`:163-168`), producing project-required apps with empty ctx. `OsShell.tsx:6-19` eagerly imports all app bodies, contrary to phase's lazy catalog contract. **Impact [INFERENCE]:** unusable project desktop and unnecessary initial loading; bundle cost not measured.

**Correction:** require valid project context; use existing lazy-loading patterns. Test actual palette command on populated desktop, not manually reproduced publication. Confidence: high.

### W9 — High: test evidence does not close reported behavior defects

**Evidence:** `os-review-apps.browser.tsx:158-219` dispatches synthetic Escape on wrapper, not real Tab/focus/paste/IME or PTY writes; claim test varies profiles, not worktrees/operations/generations (`:267-317`). `app-registry.test.ts:156-170,233-259` calls a generation-free tuple “full”. Workspace tests assert mounting/handler status only (`os-workspace-apps.browser.tsx:108-194`). Management template test manually implements append, bypassing palette (`os-management-apps.browser.tsx:176-204`). Parser tests assert intent shapes, not actual routing.

**Correction:** add regressions for stale generation during awaits, cold config load, enabled-visible tabbable containment, zero PTY writes, existing-destination payload/line delivery, actual navigation/back-forward, authoritative tunnel source, bound installation lifecycle and real palette preservation. Passing shape/mount checks and typecheck do not contradict source defects. Confidence: high.

### W10 — High: Ports request binding is only a partial repair

**Evidence:** `use-ports.ts:348-373` now selects `getBoundTransport(targetOwners[0])`, improving installer request routing. But callback omits `targetOwners`/explicit target dependencies and retains ambient generation/error comparisons; progress handlers (`:271-294`) and reconnect status (`:297-346`) remain ambient, ignoring event source owner. Explicit target change/reconnect need not refresh installer closure.

`PortsPanel.tsx:390-395,595-611` still forwards raw TunnelInfo without `PortEntry.profileId`. `PortsTunnelsApp.tsx:16-36` probes an absent TunnelInfo field and falls back to window profile; it strips qualified default to aggregate (`:46-48`). Aggregate installer selects first target rather than authoritative failed-row owner.

**Impact [INFERENCE]:** wrong-source Browser handoff, misleading cross-owner install progress/error state and stale/unavailable installation target; qualified default can aggregate other profiles.

**Correction:** carry entry profile explicitly in callback; never erase qualified default. Capture installer owner/transport once, include correct closure dependencies, and filter progress/reconnect/error publication by that exact owner. Preserve aggregate behavior only for deliberate legacy aggregation. Confidence: high.

## Suggestions / positive observations

- Prefer one small launch/delivery helper over the repeated shell handler blocks; no second controller framework. Read current Zustand state at dispatch, not a stale effect closure.
- Type manifest intents as supported `IntentAction` values and add handler/consumer behavior coverage; unrestricted `string[]` hides dead advertised actions.
- Remove/wire inert Git callbacks and resolver maximize/drag no-ops rather than adding more scaffolding. Keep canonical feature bodies/controllers.
- Keep sensitive resolver/session data excluded from persistence. Do not fix draft loss by serializing content.
- Positive: single-transport DiffViewer stat/write, fail-closed qualified project captures, exact match worktree forwarding, canonical editor open, new loading gate, child Escape precedence, improved resolver claim identity, shared instance matcher and non-destructive desktop append.
- No dependency/server schema expansion in inspected change set. Performance concern is eager loading and shell size/repetition; no measured CPU/memory/bundle regression claimed.

## Reviewed files

Paths below relative to `packages/ui/` unless stated. Large supporting files reviewed in targeted sections, not in full.

- Modified production: `src/components/organisms/{DiffViewer,PortsPanel,SearchPanel}.tsx`; `src/components/pages/{AgentStorePage,DevicesPage,SettingsPage}.tsx`; `src/embed/dam-hopper-app.tsx`; `src/hooks/{use-file-search,use-ports,use-search-panel-replace}.ts`; `src/os/{CommandPalette,Dock,OsShell}.tsx`; `src/os/{app-registry,intents,persistence,types,window-store}.ts`.
- New production: `src/os/{deep-links,desktop-templates}.ts`; all eleven new `src/os/apps/{AgentStoreApp,ChangesApp,ConflictResolverApp,FilesApp,GitApp,PortsTunnelsApp,ProjectInfoApp,SearchApp,SessionChangesApp,SettingsApp,WorkflowPlansApp}.tsx`.
- Supporting: `src/os/{window-context,DesktopCanvas,MonacoKeepAliveHost}.tsx`; `src/os/apps/{EditorApp,TerminalsApp,BrowserApp}.tsx`; `src/api/{connections,query-client,session-changes-queries}.ts`; `src/stores/editor.ts`; `src/lib/{search-replace-next,terminal-host-attachment}.ts`; `src/components/organisms/{SessionChangesHost,SessionChangesPanel,TerminalPanel}.tsx`.
- Tests: `src/os/{app-registry,deep-links}.test.ts`; `browser-tests/{os-workspace-apps,os-review-apps,os-management-apps}.browser.tsx`.
- Requirements/evidence: root `README.md`; `docs/{project-overview-pdr,code-standards}.md`; `plans/261101-1738-ai-dev-os-redesign/phase-05-app-migration-and-intents.md`; Cycle 3 review; Cycle 4 tester receipt; published AGENTS/development rules/primary workflow/code-review skill.

## Validation commands / results

Reviewer executed `git status --short && git diff --stat`, targeted `git diff`, source reads/searches. No reviewer build/test/lint/formatter or live mutations. Phase plan explicitly reserves joined verification to main; no duplicate execution.

The following are **tester-reported results**, not independently rerun. Source: `plans/reports/tester-261102-1612-phase-05-cycle-4.md:13-22,124-129`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os` | Exit 0; 9 files, 59 tests passed. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files, 9 tests passed; three consecutive runs reported passing. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, zero type errors. Not production Vite bundling. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-shell.browser.tsx browser-tests/os-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx` | Exit 0; 3 files, 16 tests passed. |

Receipt totals: 68 requested tests, 84 including related OS diagnostics. Nonfatal React `act(...)` warnings reported. Type coverage %, test coverage %, lint issue count and production bundle impact not measured. Main should run phase-listed canonical parity suites after actual corrections join; current passing mount/shape checks do not certify all acceptance rows.

## Unresolved questions

- Live PTY keyboard/paste/IME isolation, stale-owner mutation retirement, same-route/back-forward/basename navigation and actual existing-window payload journeys remain unexercised by inspected evidence.
- Production Vite bundling and canonical parity suites listed in phase are not covered by current receipt.
- No unresolved product decision blocks remediation; missing behavior is already specified by Phase 05 and ownership standards.
