# Agent Hub workspace — review cycle 1

## Score: 7/10 — changes still needed

### Scope and evidence
- Static re-review of tracked production diffs and new Hub/workspace/identity/presentation/launch modules; related unit/browser regressions, E2E journey, previous review, plan and qualification documents. Approximately 5,000 production/diff lines inspected, plus selected tests/artifacts; not an assertion that every test line was audited.
- Principal paths: `packages/ui/src/os/{OsShell,OsResourceHost,DesktopCanvas,window-ops,window-store,action-executor,persistence,agent-hub}.ts*`, `os/apps/{AgentHubApp,TerminalsApp,EditorApp}.tsx`, `os/agent-hub/*`, `os/terminal-{claim-key,launch-lifecycle}.ts`, `stores/editor.ts`, changed terminal/project organisms, workspace-selection hook and new library helpers; associated tests and six changed product documents.
- Read README, PDR, code standards, published development rules/primary workflow and code-review skill. Review focus: previous C1–C3, remaining warnings, ownership, destructive actions, resource continuity, persistence, maintainability and qualification accuracy.
- Assignment reports UI **370 files / 3,537 tests**, browser **64 files / 358 tests**, web build and lint passing, zero errors. These are supplied results, not checks exercised by this reviewer. No builds, tests, linters or formatters rerun. Numeric type/test coverage unavailable; zero lint errors does not establish zero warnings.
- Updated plans: none; assigned re-review does not own product or task-state changes. Only this report created.

## Previous critical findings

| Finding | Cycle 1 assessment | Source evidence |
|---|---|---|
| C1 Review session resolution | Original qualified/raw-ID mismatch corrected in source. | `AgentHubApp.tsx:109-129` compares the callback ID with `terminalKey(item.terminalRef)`; inventory raw IDs remain distinct. Exact request fences remain in `agent-hub-review.ts`. |
| C2 Pin projection/protection | Rendered projection corrected; persistent protection still incomplete. | `AgentHubApp.tsx:64-73,226-247` supplies reactive `isPinned`; `TabBar.tsx:129-170` reflects pressed state and removes Close. Persistence/readiness defect below remains; callback guard also has a missing dependency. |
| C3 Agent evidence join | Original composition mismatch corrected. | `use-agent-hub-workspaces.ts:305-345` supplies raw metadata IDs through `agentRosterGroups`, preserving qualified UI IDs. `traditional-terminal-agents.ts:140-161` supplies generation/availability/epoch-qualified presentation to the counters. Raw fallback remains a defense-in-depth concern. |

No new authentication bypass or injection vulnerability established in inspected UI-only changes. This is not security certification or live qualification.

## Critical issues / required fixes

**Critical-severity issues established: none.** One **High-priority incomplete C2 behavior** remains:

### H1. Loading terminal inventory can permanently erase saved pins
- **Location:** `packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.ts:84-125`; `use-agent-hub-workspaces.ts:168-170,259-268`; `lib/agent-hub-open-workspaces.ts:65-93`.
- **Failure:** Pin retention treats all current group tabs as authoritative live inventory. Projects and terminal inventories load independently. A persisted open workspace can hydrate from project inventory while terminal inventory is pending, producing a profile-qualified group with no tabs. The retention effect loads saved pins, intersects them with an empty set, and writes the deletion to sessionStorage.
- **Impact:** When the still-live terminal inventory arrives, its pin has already been removed. Reload/reconnect can restore a closeable terminal despite the previous protection. This is a source-supported ordering defect; not runtime-reproduced here.
- **Correction:** Load/display stored pins without destructive pruning until a successful current-owner terminal observation establishes authoritative membership for that profile. Do not interpret loading/disconnected/error as successful empty inventory. Test projects-loaded → terminals-pending → terminals-loaded, plus reconnect.
- **Confidence:** High from direct state/data flow.

## Warnings — remaining SHOULD FIX items

1. **Pin close guard captures stale state under stable dependencies.** `use-hub-terminal-tab-actions.ts:162-167,227-234` reads `isTabPinned` inside `useCallback` but omits it from dependencies. With stable options/coordinator, pin-only updates preserve the callback's old pin accessor; unpinning can likewise retain rejection. Other dependency churn may mask this in current composition. Add `isTabPinned` to dependencies and test stable-options pin → close denied, unpin → close allowed. **Medium; high confidence.**

2. **W1 unchanged — saved workspace selection overwritten during restore.** Display reports default/null selection immediately (`TraditionalTerminalProjectsDisplay.tsx:312-319`), while `handleSelectedGroupChange` persists it unconditionally (`use-agent-hub-workspaces.ts:457-463`). That can replace the saved key while restoration waits (`:351-381`). Gate initialization persistence until restore completes or preserve an independent initial restore key. Test actual parent/Display with delayed inventory. **Medium; high confidence.**

3. **W2 unchanged — actual StrictMode replay loses the Hub claim.** `use-hub-terminal-attach-gate.ts:124-135` returns when desired keys are unchanged; passive cleanup `:219-234` releases/clears held claims without clearing the desired map. Replayed setup retains refs, sees equal desired keys and does not reacquire unless some later registry notification rescues it. Test `:200-239` destroys/recreates a root rather than mounting `<StrictMode>`. Reconcile missing claims or reset desired state consistently; test real replay. **Medium; high confidence from lifecycle inspection, not runtime-reproduced.**

4. **W3 unchanged — close currency check is tautological.** `use-hub-terminal-tab-actions.ts:173-186` obtains offered/current targets from the same captured map. Compare an offered target with a committed current resolver. Exact downstream target/owner guards remain relevant; this finding does not establish replacement-PTY termination. Current test `:192-220` covers absence, not replacement. **Medium; high confidence.**

5. **W4 unchanged — header worktree label not reactive.** `AgentHubApp.tsx:99-106` reads `getState().activeTargetByProject` in a memo depending only on `selectedGroup`. Worktree selector/tree and launch can use the new worktree while the header still shows the old one. Use `useProjectTarget` or a narrow store subscription. **Medium; high confidence.**

6. **W5 unchanged — E2E assertions do not prove required scenarios; one selector is invalid.** `e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts:165-183` conditionally skips isolation and accepts `editor count >= 1`; secondary profile is not exercised. `:194-225` checks DOM tokens but no streaming/input markers, project switch, split or quiet handoff. `:289-295` omits 1920×1080. Additionally `:228` searches `section[aria-labelledby*="agents"]`, whereas navigator `:69-70,192-195` uses generated `useId()` identifiers, not IDs containing “agents”. Require fixtures/assertions, exact distinct owner-qualified windows and real input/output oracles; use a named-region/stable selector. **Medium; high confidence.**

7. **W6 unchanged — qualification statuses overstate closure.** `phase-07-qualification-and-docs.md:10,79-84` marks live qualification complete despite `reports/qualification-report.md:6,18` explicitly keeping it open. Its AC table `:103-108` and final `:177` overstate qualification; overview `plan.md:4,20-26` still marks phases pending. Reconcile with actual evidence. Retain live checks and human visual review as open gates. **Medium; high confidence.**

8. **C3 fallback still fails open on agent-status authority.** `os/agent-hub.ts:280-290,321-342,380-385` can synthesize Working/Attention and `availability: ready` from retained equal-incarnation status whenever the traditional row is absent, without checking status owner generation/availability/epoch. The new adapter repairs the normal production join, so this is not a claim that normal counters remain broken. Fail closed when no authoritative presentation exists; add unavailable/retired-status cases through real Hub composition. **Medium, defense in depth; high confidence in fallback behavior.**

## Suggestions

- Add composition regressions for Review click with qualified IDs, rendered pin pressed/close state and reload, delayed workspace restore, and unavailable/retired status counters. Current `os-agent-hub.browser.tsx` has four render/sidebar/recipes/empty-state cases, not these three fix-specific interactions.
- Deduplicate local presenter teardown in `PaneContainer.tsx:167-220,259-278` and duplicated success-settlement/durable-read handling in `terminal-launch-lifecycle.ts:464-499,570-602`; retain every owner/token check, no new framework.
- `stores/editor.ts:1813-1819,1861-1868`: preserve the buffer as now, but surface an actionable non-destructive discard/reload failure notice.
- Keep renderer measurement scoped: zero tracked subscriptions proves release of those tracked registrations, not general leak freedom. A single fleet size and uncontrolled whole-heap samples do not establish 0.8–1.5 MiB retained heap/session (`qualification-report.md:158-160`). No renderer cap requested; uncapped renderers remain an accepted decision.
- Correct documentation details: `docs/frontend-components.md` names `dam-hopper:pinned-terminals`, while actual key is `dam-hopper:terminal-pins:v2:<profile>` in sessionStorage (`terminal-pin-persistence.ts:1-6,20-23`); qualification B2 text says z-index 45/40 while implementation uses focused float 60.

## Positive observations
- Qualified Review resolution and rendered pin projection now connect the previously isolated contracts.
- Logical persistence remains separated from generation/epoch-qualified runtime authority.
- Endpoint identity is captured before file reads and travels with the retained baseline; dirty/alias preservation and explicit discard confirmation are deliberate safety measures.
- Shared launch lifecycle is window-independent; manual clearance uses fresh owner-qualified observations and durable settlement rereads.
- No TODO/FIXME/HACK/XXX markers found in searched new Hub/lifecycle/identity/presentation/workspace production modules.

## Recommended handoff
1. Fix readiness-aware pin retention, pin guard dependency, restore ordering and claim replay; add meaningful composed regressions.
2. Main runs focused checks for those transitions, then existing aggregate UI/browser/build/lint gates once after edits. Report current warnings separately from error count.
3. Complete the required live PTY/input/editor and capture scenarios before closing qualification; keep human visual approval separate.

## Unresolved evidence
- No fresh execution performed by this reviewer. Source fixes are statically assessed, not runtime-certified.
- Assignment's latest UI/browser/build/lint results supersede older browser-failure evidence; no newer server-suite result is supplied. Earlier tester report records MongoDB-blocked cargo qualification, not a UI product defect.
- Live streaming/input isolation, quiet handoff, complete owner/worktree/dirty-editor journeys and required capture matrix remain unestablished in inspected artifacts.
