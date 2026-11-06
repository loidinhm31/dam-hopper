# Integrated Agent Hub workspace code review

## Score: 6.5/10 — changes required before sign-off

### Scope and evidence
- Static assessment of tracked production changes plus new workspace/Hub/presentation/launch modules, supporting unit/browser/E2E assertions, implementation plan and six changed product documents. Approximately 6,000 production/diff lines plus selected test/document sections inspected; not a claim that every test line was audited.
- Principal paths: `packages/ui/src/os/{OsShell,OsResourceHost,DesktopCanvas,WindowFrame,window-ops,window-store,action-executor,persistence,agent-hub,terminal-close-context}.ts*`; `os/apps/{AgentHubApp,TerminalsApp,EditorApp}.tsx`; `os/agent-hub/*`; `os/terminal-{claim-key,launch-lifecycle}.ts`; `stores/editor.ts`; changed terminal/project organisms, selection hook, badge components and new library helpers. Reviewed relevant associated tests, browser fixtures and `e2e/os-agent-hub-workspace/`.
- Read README, PDR, code standards, published development rules/primary workflow and code-review skill. Security focus: profile/generation/epoch ownership, termination authority, editor baseline provenance, input isolation and persistence. Architecture/performance focus: single runtime hosts, claims, state ordering, allocations on inventory updates, YAGNI/KISS/DRY.
- No product/test/plan edits by reviewer; only this report created. No builds, tests, linters or formatters executed. Verification belongs to integration owner. Existing reports contain historical execution results, not fresh verification of corrections made during this review.
- Main is editing concurrently. Findings below distinguish observed source corrections from outstanding issues; further changes need integration-owner verification.

## Critical issues list

**No unresolved Critical-severity vulnerability established in the latest inspected close branch.** One critical-risk destructive fallback was found and corrected in source during review:

- **Unsafe cross-profile termination fallback — source corrected, regression execution unverified.** Initial `os/agent-hub/use-hub-terminal-tab-actions.ts:217-234` used ambient `api.terminal.remove/kill` when a qualified tab lacked an authoritative target/coordinator or its owner was disconnected. Equal raw IDs could address the wrong server; this also bypassed incarnation/epoch guards. Latest inspected branch (`:198-223`) uses the coordinator for exact targets, locally dismisses exited views and otherwise reports unavailable. No ambient removal remains in that inspected branch. Preserve a negative regression: unavailable qualified target invokes neither ambient nor other-profile mutations.

## Warnings list

### H1. Pin pruning still lacks per-profile terminal-inventory authority
- **Evidence:** `os/agent-hub/use-agent-hub-workspaces.ts:168-172` now exposes terminal aggregate `isSuccess`; `hooks/use-aggregated-terminal-sessions.ts:134-139` defines that flag with `queryResults.some(r => r.isSuccess)`. `os/agent-hub/use-hub-terminal-tab-actions.ts:97-123` uses one readiness boolean to intersect each profile's stored pins with currently rendered tabs.
- **Failure/impact:** Profile A succeeds while profile B is connected but pending/failed. B's persisted open workspace exists via project inventory, but its terminal tabs are empty. Aggregate success permits deleting B's saved pins. A later successful B inventory restores an unpinned, closeable terminal. Initial project-loading-based wiring was changed, but aggregate success does not close the multi-profile hole.
- **Correction:** Prune only against a successful current-owner observation for that individual profile. Preserve pins for pending/error/disconnected/retired owners; never use project loading or any-profile success as membership authority.
- **Validation:** Composed A-ready/B-pending → B-ready and A-ready/B-error/reconnect tests, with persisted B pins. Existing boolean-injected hook test does not establish parent wiring.
- **Severity/confidence:** High / high; source-supported ordering defect, not runtime-reproduced here.

### H2. Pane writes bypass the new presentation-input policy
- **Evidence:** `components/organisms/PaneContainer.tsx:154-220` acquires/releases the active terminal's token, but `:223-227` subsequently calls raw `syncTerminalInputSuppression(term, shouldSuppressTerminalFocus)` for every tab. `lib/terminal-input-policy.ts:28-40` directly writes `disableStdin` and textarea tab index. `lib/terminal-presentation-input.ts:171-186` requires managed terminals without a presenter to remain suppressed; `TerminalPanel.tsx:596-599,1053-1059` checks the mutable stdin flag and replay/owner state, not presentation authority independently.
- **Failure/impact:** Switching between already-managed, quiet, replay-complete tabs releases the old token, then the loop can immediately write `false` for the now-hidden old terminal. Its computed no-presenter suppression is overridden until another presentation/stream notification. Incorrect stdin/textarea state is supported by the source; an actual wrong-PTY keystroke was not reproduced by this review.
- **Correction:** Do not let pane-local raw writes undo combined panel/replay/presentation suppression. Use presenter-scoped reasons and retain one effective suppression authority; input dispatch should not trust a flag another layer can weaken.
- **Validation:** Real TerminalPanel + pane composition: visible terminal accepts a marker; hidden/released quiet terminal receives zero transport writes, including tab change and predecessor cleanup after successor acquisition.
- **Severity/confidence:** High-priority input-isolation risk / high confidence in policy bypass; end-user exploitability unverified.

### W1. Delayed restore can overwrite the saved selected workspace
- **Evidence:** `TraditionalTerminalProjectsDisplay.tsx:317-324` reports default/null selection on initial mount; `use-agent-hub-workspaces.ts:459-465` persists it without a restore gate; restoration waits separately at `:351-383`.
- **Failure/impact:** Child initialization replaces the persisted key while project inventory is pending. A later render sees no saved key and consumes restoration as dropped. Workspace selection does not reliably survive reload.
- **Correction:** Preserve an independent initial restore key and gate initialization persistence until restoration completes. Test actual parent/display composition with delayed inventory, not only the pure resolver.
- **Severity/confidence:** Medium / high.

### W2. File-tree relocation is additive, not a clean move
- **Evidence:** `TraditionalTerminalProjectWorkspaceRow.tsx:319-326` still mounts a tree for every disclosed project; `TraditionalTerminalProjectsDisplay.tsx:691-723` also mounts the selected project's right tree. `AgentHubApp.tsx:246,250` continues supplying disclosure state/actions.
- **Failure/impact:** A disclosed nonselected project's inline tree remains browsable; the selected project can have two simultaneous tree instances. Closing the right Files sidebar does not hide those inline trees. This conflicts with the selected-project-only/right-sidebar polish request and retains redundant UI state/render work. Duplicate network subscriptions were not measured.
- **Correction:** For Hub composition, remove obsolete inline-tree/disclosure rendering and retain the single selected-project right tree. Preserve shared non-Hub behavior only where an existing caller requires it.
- **Severity/confidence:** Medium / high.

### W3. Integration assertions do not establish the named lifecycle scenarios
- **Evidence:** `e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts:157-187` closes the first editor before opening a second project; it never provisions/exercises the claimed second profile or changes worktree. `:189-225` checks terminal visibility and token identity without sending/observing streaming markers, switching projects or splitting. `:227-235` conditionally attempts Close with no termination/Hub-survival assertion. `browser-tests/os-hub-terminal-mounts.browser.tsx:323-377`, named “quiet PTY input reaches transport,” neither mounts a standalone app nor types/asserts transport writes; its last assertion only checks that `disableStdin` is defined.
- **Impact:** Passing these tests does not prove cross-owner isolation, streaming continuity, quiet handoff or close isolation. This finding concerns assertion strength, not a claim that an unobserved execution failed.
- **Correction:** Use mandatory fixtures and behavioral oracles: simultaneous owner-qualified editors; same path across profiles/worktrees; stream markers before/after actual transitions; zero hidden-terminal writes; a successful visible quiet-handoff control; exact clicked-PTY termination plus surviving Hub/sibling PTY.
- **Severity/confidence:** Medium / high.

### W4. Completion and evidence labels overstate qualification
- **Evidence:** `plan.md:4,20-26` and `phase-07-qualification-and-docs.md:10,79-84` mark complete; `reports/qualification-report.md:6,18` still records an open live-container gate, while `:103-108,177` labels acceptance PASS/fully qualified. The inspected E2E directory contains spec and pending `review.md`, not generated `evidence.json`/captures. Spec `:304-310` omits required 1920×1080 despite the ledger listing it.
- **Impact/correction:** Distinguish implementation delivered, automated evidence, live acceptance and human visual approval. Attach actual current run artifacts, retain missing gates as open and add the required capture size. Do not infer passing behaviors from test names or checkbox completion.
- **Severity/confidence:** Medium / high regarding inspected artifacts; additional uninspected external evidence may exist.

### W5. Agent fallback still bypasses part of authoritative presentation
- **Evidence:** `os/agent-hub.ts:280-290,321-352` can synthesize Working/Attention from equal-incarnation raw status when no traditional row exists. The added availability guard checks `ready`, but not the status view's current owner generation or a non-null epoch. The canonical builder checks current profile/generation and rejects ready-with-null-epoch at `lib/traditional-terminal-agents.ts:140-147`; this is not an assertion that it compares epoch equality with terminal inventory.
- **Impact/correction:** Stale same-incarnation evidence can be represented as current outside the normal successful join. Prefer unavailable/unobserved when authoritative presentation is absent, or reuse its exact current-owner/readiness checks. Normal production join is improved; this is defense in depth, not proof normal counters always fail.
- **Severity/confidence:** Medium / high for fallback behavior; normal-path frequency unestablished.

## Suggestions list
1. **DRY/KISS:** Extract the repeated presenter teardown in `PaneContainer.tsx:167-220,259-278` into one narrow helper, preserving token checks. Likewise consolidate duplicate found-target settlement/durable verification branches in `terminal-launch-lifecycle.ts:464-499,570-602`. No new framework needed.
2. **Error handling:** `stores/editor.ts:1813-1819,1861-1868` correctly preserves the buffer on discard/reload failure, but should expose a non-destructive actionable error instead of silently ending loading.
3. **Performance evidence:** Retain the accepted uncapped renderer decision. Report only measured tracked-subscription cleanup; zero tracked callbacks is not general heap-leak freedom. One uncontrolled whole-heap sample sequence does not establish the per-session 0.8–1.5 MiB claim in qualification report `:158-160`.
4. **Documentation accuracy:** Correct `docs/frontend-components.md` pin storage name (`dam-hopper:terminal-pins:v2:<profile>` in sessionStorage, not `dam-hopper:pinned-terminals`) and qualification stacking labels (focused float is 60, not 45).
5. **Regression quality:** Use real `<StrictMode>` for attach-claim replay coverage; `use-hub-terminal-attach-gate.test.ts:200-239` destroys/recreates roots instead. Current cleanup resets desired entries, a source improvement, but the named test does not exercise React effect replay.

## Positive observations
- Shared launch lifecycle replaces duplicated asynchronous create logic; durable rereads and explicit uncertain outcomes are appropriate.
- Logical persisted workspace IDs remain distinct from runtime generation/epoch-qualified authority.
- Endpoint identity travels with the content baseline, survives dirty aliases/persistence, and explicit discard/reload is confirmation-guarded. Same-endpoint reconnect is intentionally separate from endpoint change.
- Root keep-alive hosts, stable mount-key merging, exact resource claims and atomic reveal/float operations are coherent architectural choices.
- Badge typography now uses shared semantic `text-xs`; no extra settings/abstraction introduced.
- No new authentication/injection issue established in inspected UI changes. No TODO/FIXME/HACK/XXX markers found in searched new Hub/lifecycle/identity/workspace modules.

## Validation handoff and metrics
- Integration owner: fix H1/H2, add meaningful composition regressions, then run focused unit/browser checks and existing aggregate UI/build/lint gates once after edits. Complete actual live input/PTY/editor and capture scenarios before closing qualification.
- Latest inspected historical full-suite report records 3,537 unit tests passing, build passing with warnings and lint 0 errors/379 warnings; earlier browser import failures and MongoDB-blocked server qualification are recorded there. Other qualification reports claim later automated successes. None establishes the concurrently modified review corrections without fresh owner-run evidence.
- Type coverage: not measured. Test coverage percentage: not supplied. Current lint count: unverified. No checks exercised by this reviewer.

## Unresolved evidence
- Main reported concurrent repairs; latest final diff and regression execution remain integration-owner responsibilities. The unsafe ambient close fallback was statically observed removed; per-profile readiness and effective input-policy corrections were not observed complete at report cutoff.
- The inspected close-hook correction snapshot also lacked imports for still-referenced `parseTerminalKey` and `getConnectionSnapshot`; Main was notified. This transient source compile concern needs closure in the final integrated tree; no compiler was run here.
- Live quiet handoff/hidden-input isolation, complete owner/worktree editor journeys and required capture matrix are not established by inspected assertions/artifacts. Human visual review remains pending.
