# Code Review — Phase 05 remediation

## Overall assessment

**Score: 6/10 — request changes.** Improvements are real, but the five targeted warning contracts cannot all be closed. W4's explicit-operation rejection is resolved in inspected control flow; W0a, W0b, W1 and W5 retain correctness gaps. Passing selected checks do not establish end-to-end safety.

Method: published `code-review` skill; targeted review of all 19 changed files, supporting ownership/state/query implementations, Phase 05, Cycle 5 findings, PDR and code standards. Review covers security, performance, architecture and YAGNI/KISS/DRY. Runtime impacts below are **[INFERENCE]** from source unless explicitly attributed to QA. Not a whole-repository security audit. No production/test/plan/task-state edits; only this report authored. Plan status remains coordinator-owned; phase already distinguishes administrative DONE from incomplete technical acceptance.

## Critical issues

None established at Critical severity. No backend/authentication/dependency change, exposed secret or exploitable injection found in inspected changes. High-priority data-integrity and owner-routing defects remain below.

## Warnings

### R1 — High: successful diff save can still overwrite newer typing through refetch

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:491-500,753-758`; `packages/ui/src/api/queries.ts:333-350,1318-1332`; upstream [`@monaco-editor/react` v4.7.0 DiffEditor:95-116](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/DiffEditor/DiffEditor.tsx#L95-L116) (dependency declared `^4.7.0`).

The new comparison correctly keeps `isDirty` true immediately after writing A when the user has typed B. But it then invalidates the active file-diff query, while `DiffEditor.modified` remains controlled by `data.modified`. Refetched disk content A changes that prop from its original baseline; the wrapper executes a full-model edit to A, replacing B. The content listener then compares A against `savedContentRef = A` and marks clean. The post-write dirty comparison alone does not protect the actual model.

**Impact [INFERENCE]:** newer unsaved typing disappears after the successful write/refetch. **Correction:** keep dirty modified-model content authoritative across query refreshes; update the saved baseline without driving older disk content into that model. Test delayed write followed by actual changed `modified` props/refetch and assert both newer text and dirty state survive. **Confidence: high.**

Additional W0a residual: `DiffViewer.tsx:502-515` checks operation/document identity but not captured owner on rejected awaits. A late rejected old-generation target error can still call `onTargetUnavailable` and publish an error into a reconnected view. Fence failure publication by the captured owner as well. The delayed-stat idle reset is fixed.

### R2 — High: search-result generation is transported but not enforced before opening

**Evidence:** `packages/ui/src/os/apps/SearchApp.tsx:52-63`; `packages/ui/src/os/OsShell.tsx:240-261`; `packages/ui/src/api/client.ts:2074-2088`; `packages/ui/src/os/window-context.tsx:42-45`; `packages/ui/src/stores/editor.ts:575-580,658-663`.

SearchApp now includes match generation. The shell only copies it into `targetCtx`; the target passed to `editor.open` omits it, and the handler never compares it with the live snapshot. Target normalization drops generation anyway, and the context provider derives generation from the current connection rather than the delivered context. Editor opening consequently captures today's owner, not the result's originating owner.

**Impact [INFERENCE]:** clicking a retained generation-1 result opens/reloads against generation 2. **Correction:** reject stale/disconnected delivered generations before any editor-store mutation/read and preserve one captured owner through the canonical open operation. Add an old-result-after-reconnect browser assertion that no open/read occurs. **Confidence: high.**

### R3 — High: Replace All's second dirty check still reads a frozen snapshot

**Evidence:** `packages/ui/src/hooks/use-search-panel-replace.ts:70,361-371,410-423,439-445`; `packages/ui/src/stores/editor.ts:878-885`.

`checkDirtyTab` closes over the render-time `tabs` array. The new call after `await fsRead` therefore does not observe edits made during that read, or while processing an earlier file group. Editor edits replace tabs immutably, so rerendering the hook cannot update this in-flight closure.

**Impact [INFERENCE]:** Replace All writes to a file that has become dirty since the operation started, defeating the explicit dirty-buffer protection. CAS checks disk mtime, not unsaved model content. **Correction:** query `useEditorStore.getState().tabs` at each mutation boundary, particularly immediately before write. Add deferred-read/new-dirty-tab coverage. Qualified per-match stale/mixed-generation rejection and read/write owner reuse are correctly implemented. **Confidence: high.**

### R4 — High: a targeted search intent changes every Search window

**Evidence:** `packages/ui/src/os/apps/SearchApp.tsx:20-28`; `packages/ui/src/components/organisms/SearchPanel.tsx:60-82`; `packages/ui/src/stores/search-ui.ts:24-43,61-64`.

The new consumer writes the delivered query to the module-global `useSearchUiStore`. All SearchPanel instances read the same query/mode/scope, irrespective of profile, project or worktree. An intent to window A therefore changes B's input and search request too; remounting a window replays its stale appState query into that same global store.

**Impact [INFERENCE]:** cross-window view-state coupling and unintended searches/query disclosure to other selected servers; duplicate remote work. **Correction:** supply per-window controlled search view state, retaining the existing global store only for the legacy route adapter. Test two simultaneous windows on different owners, then switch/minimize/remount. **Confidence: high.**

### R5 — High: Agent Store selector retargets the body but not profile-instance identity

**Evidence:** `packages/ui/src/os/apps/AgentStoreApp.tsx:13-25`; `packages/ui/src/os/OsShell.tsx:556-572`; `packages/ui/src/os/app-registry.ts:159-162`.

Selecting B in a window created for A only updates `appState.profileId`; `ctx.profileId` stays A. Deduplication still identifies that window as A, and reused `agent-store:open` delivery updates only its tab. Opening A again therefore focuses the window still operating on B; opening B can create another B-targeted window.

**Impact [INFERENCE]:** wrong-server management after an explicit owner launch and broken profile-instance guarantees. **Correction:** keep effective target and instancing identity synchronized atomically, or keep the window pinned and route profile selection through canonical launch/focus. Re-delivery must establish the requested target, not only the tab. Test A → selector B → explicit launch A/B. **Confidence: high.**

### R6 — High: Settings cannot select Current/Default after an explicit target

**Evidence:** `packages/ui/src/components/pages/SettingsPage.tsx:67-72,349-363`; `packages/ui/src/os/apps/SettingsApp.tsx:24-36`; `packages/ui/src/os/window-store.ts:261-273`.

The Current/Default option emits `null`. SettingsApp stores it as `undefined`, then `appState.profileId ?? window.ctx.profileId` resolves to the original explicit owner. For a window created with A, selecting Current/Default snaps back to A and keeps management requests on A. This conflates absence of a delivered override with an explicit default choice.

**Impact [INFERENCE]:** selected management target is not honored. **Correction:** represent default selection distinctly from absent delivery; resolve and display that deliberate target consistently without falling back to the window's old owner. Also lift DevicesPage selection through the same target callback: it currently keeps an independent selection at `DevicesPage.tsx:22-30,59-60`, so switching tabs discards its choice and can show a different server in General versus Devices. **Confidence: high.**

### R7 — Medium: terminal focus validates existence only when no terminal window exists

**Evidence:** `packages/ui/src/os/OsShell.tsx:591-632`; `packages/ui/src/os/apps/TerminalsApp.tsx:18-21,47-54`.

If any same-profile terminal window exists, the handler overwrites its session ID and reports handled before consulting the registry. The exact-match branch also accepts a stale session without validation. The new unknown-terminal test covers only an empty desktop.

**Impact [INFERENCE]:** focusing an unknown/stale session can replace a working terminal surface with an unattached one rather than rejecting safely. No new PTY creation path was found in this handler, which is good. **Correction:** validate the requested live owner/session before changing any window; focus an exact match or attach the validated session without arbitrary stale substitution. Test unknown IDs with an existing working terminal window and reconnect/removal. **Confidence: high.**

### R8 — Medium: repeated identical intent payloads are not delivered as new requests

**Evidence:** `packages/ui/src/os/OsShell.tsx:667-672,706-712`; `packages/ui/src/os/apps/SearchApp.tsx:20-28`; `packages/ui/src/os/apps/ChangesApp.tsx:25-49,122-124`.

Consumers depend only on scalar query/path/tab props. After opening a diff and manually returning to Files, a second identical `changes:diff` leaves all dependencies unchanged and does not return to Diff. Similarly, after editing the SearchPanel input, sending the original query again does not reapply it because appState still contains that original query.

**Impact [INFERENCE]:** handler reports handled while the requested canonical action does not happen in a reused destination. **Correction:** use a delivery revision/nonce or update canonical controlled view state directly, not an initial-state mirror. Add repeated-same-payload tests after local interaction. **Confidence: high.**

## Resolution ledger

| Target | Result |
| --- | --- |
| W0a DiffViewer | Partial: dirty comparison, operation/document guard and stat-abort idle reset improved; refetch can still replace newer text; rejected-await owner fence incomplete. |
| W0b Search ownership | Partial: qualified Replace All per-match generation check and single owner read/write reuse resolved; result opening still ignores generation; live dirty recheck ineffective. |
| W1 Intent delivery | Partial: three missing handlers added; global search state, repeated delivery and terminal validation gaps remain. This review does not certify other previously advertised actions. |
| W4 Conflict Resolver | Resolved in inspected branches: waits for loading and rejects absent/none/mismatched explicit operation before mounting editor; Continue/Abort use the same rule. Browser receipt includes unavailable-operation case. |
| W5 Management props | Partial: AgentStore controlled tab rendering no longer consumes URL tab state; Settings reacts to delivered tabs/profile; owner/default/instancing inconsistencies remain. |

Earlier W2/W3/W6–W10 phase debt is not reclassified as newly introduced here and is not certified closed by this scoped review. SessionChanges useState/import change preserves mount-time capture but does not itself resolve prior offscreen-lifecycle or physical PTY-input gates.

## Suggestions / architecture and performance

1. Reuse a small launch/focus/deliver helper and current store snapshots rather than adding another orchestration framework; existing adapters should remain thin wrappers around canonical feature bodies.
2. Keep per-window view state canonical instead of mirroring appState into local state and global stores. Use one explicit target representation across Settings/Devices and Agent Store instancing.
3. Remove unused DiffViewer operation bookkeeping (`id` has no identity comparison; stored `content`/`filePath` are not read). Object identity already owns the save. The `targetGen` branch cannot preserve a generation removed by `normalizeProjectTarget`; model owner identity explicitly rather than duck-typing it.
4. Strengthen behavioral test oracles: new workspace tests assert store payloads, not rendered query/diff or actual terminal attachment. The management test named “without mutating route URL” never clicks a control or asserts the URL. Use deferred promises rather than fixed 50/70 ms waits for save races. Add two-owner, reused-window and post-write-refetch journeys before closing these warning contracts.
5. No new dependency, unbounded background work, injection primitive or measured performance regression established. The global search-state coupling creates concrete duplicate remote work (R4). Existing eager app imports and large repeated shell handlers remain prior maintainability/load debt; no bundle-cost claim made.

Positive: no backend API expansion; canonical page/organism reuse; explicit-operation resolver rejection; qualified Replace All stale/mixed generation rejection before read; captured read/write transport reuse; DiffViewer operation identity and mounted/document guards; no PTY allocation in terminal:focus; Settings preferences-source selection remains separate from target-server selection.

## Reviewed files

All 19 changed files, production/test modifications inspected in relevant sections and diffs:

- `packages/ui/src/components/organisms/DiffViewer.tsx`
- `packages/ui/src/components/organisms/DiffViewer.test.tsx`
- `packages/ui/src/hooks/use-search-panel-replace.ts`
- `packages/ui/src/hooks/use-search-panel-replace.test.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/intents.ts`
- `packages/ui/src/os/apps/SearchApp.tsx`
- `packages/ui/src/os/apps/ChangesApp.tsx`
- `packages/ui/src/os/apps/TerminalsApp.tsx`
- `packages/ui/src/os/apps/ConflictResolverApp.tsx`
- `packages/ui/src/os/apps/SessionChangesApp.tsx`
- `packages/ui/src/components/pages/AgentStorePage.tsx`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- `packages/ui/src/components/pages/DevicesPage.tsx`
- `packages/ui/src/os/apps/AgentStoreApp.tsx`
- `packages/ui/src/os/apps/SettingsApp.tsx`
- `packages/ui/browser-tests/os-workspace-apps.browser.tsx`
- `packages/ui/browser-tests/os-review-apps.browser.tsx`
- `packages/ui/browser-tests/os-management-apps.browser.tsx`

Supporting sections: `api/{client,connections,ownership,queries}.ts`; `stores/{editor,search-ui}.ts`; `lib/{terminal-registry,search-replace-next}.ts`; `os/{app-registry,window-store}.ts`; `os/window-context.tsx`; `hooks/use-conflict-resolver.ts`; `packages/ui/package.json`; upstream Monaco wrapper; root README, PDR, code standards, Phase 05 plan, Cycle 5 review and tester rerun receipt. Approximately 2,000 changed/current production lines plus supporting/test sections examined; not full-file/full-repository certification.

## Validation commands / results

Reviewer executed `git diff --stat`, targeted `git diff`, source reads and ownership/callsite searches. No reviewer build/test/lint/formatter or live mutation; joined verification remains main/tester-owned under phase ownership contract. No duplicate execution of reported checks.

**QA-reported, not independently rerun:** `plans/reports/tester-261102-1804-phase05-remediation-rerun.md:14-20,38-41,45-68,81-86`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os src/hooks/use-search-panel-replace.test.tsx src/components/pages/AgentStorePage.test.tsx src/components/organisms/DiffViewer.test.tsx` | Exit 0; 12 files; 97 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files; 14 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) | Exit 0; 0 type errors. This is typecheck, not production Vite bundling. |

Total receipt: **111/111 selected tests passed**. Nonfatal React `act(...)` warnings remain. Type/test coverage percentages, lint issue counts, production bundle, complete canonical parity and live-server mutation/input journeys not measured by this receipt. Test count is not a coverage percentage.

## Unresolved questions

- No product/design clarification blocks the listed corrections; required behavior is already specified.
- Runtime outcomes for the reported races/retargeting and repeated-intent cases remain unexercised by the inspected receipt. Current tests do not answer whether newer Monaco text survives the successful-save refetch or whether two Search windows stay independent.
- Broader phase qualification (offscreen Session Changes retirement, actual background PTY keyboard/paste/IME isolation, navigation/back-forward/basename, canonical parity and production bundling) remains outside this remediation receipt and is not certified closed.
