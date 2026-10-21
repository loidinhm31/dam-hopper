# Phase 05 follow-up review (cycle 2): scoped client and drafts

**Score: 6/10. CHANGES REQUESTED.**
C1 and C2 fixes verified in code. C3 still open by design. One new blocking defect (H1). Phase 05 "Complete / 100%" in plan.md and the phase file overclaims.

Read-only review. I ran nothing. Test and typecheck figures come from `tester-261021-0041-phase-05-scoped-client-drafts.md` (80 UI unit + 1 browser + 40 Rust conflict tests pass, `tsc` clean).

## Prior-finding closure

| Item | Status | Evidence |
|---|---|---|
| C1 wire discriminator | FIXED | `client.ts:2475-2489` `ResolveAction` uses `type`. Rust is `tag="type"` + `deny_unknown_fields` (`types.rs:569-589`). Producers: `use-conflict-resolver.ts:528`, `transitions.ts:188-193`. `ws-transport.test.ts:2253` asserts the HTTP body for all three actions (reviewedText/indexSide/delete), including `worktreePath`. |
| C2 retirement on navigation | FIXED | Retire effect (`hook:125-146`) iterates the owners of stored drafts and retires only when `!isCurrentConnection` or `onConnectionInvalidated` fires. It no longer follows target selection. Test `use-conflict-resolver.test.tsx` "retains another profile's draft…" renders A then B, draft A stays live, `disconnectProfile(A)` retires it. |
| C2 no way out | FIXED | `importRecoveryDraft` (hook:405-474, store:196-263): requires the original profile/serverUrl/project/worktree/root, fresh inventory and snapshot, same path, same repositoryRoot/worktreeRoot, distinct draft id. Sets `requiresReview`. `confirmFreshReview` (hook:669-701) re-fetches and requires same snapshotVersion and index fingerprint. Apply is blocked until confirmed. Editor wires the import, confirm and discard buttons. Store tests cover the happy path, unchanged-snapshot replay and cross-endpoint refusal. |
| W1 recovery apply | FIXED | `applyDraft` (hook:482-507) and `startResolveAttempt` (transitions:179) both refuse `isRecovery`, `requiresReview`, `isApplied`. |
| W2 refresh scope | FIXED | `finally` uses `refreshOwnerScope(draft.scope)`. Uses `api.git.operationStatus` for non-selected scopes. Failure sets `refreshError` only for the selected scope. |
| W3 invalidation and dead export | FIXED | `invalidateGitProjectQueries` is exported and called (hook:562-571). `useGitResolve` is deleted and has no callers. |
| W4 applied + newer typing | FIXED in editor | `MergeConflictEditor.tsx:671-683` calls `onResolved()` only when the draft is clean. Otherwise shows the split-state message. |
| W8 in-flight retire | Mostly fixed | `markAsRecovery` after the late outcome gives a specific reason (hook:547-552). `retireScope` still nulls `inFlightAttempt`, so the outcome is not reconciled. Acceptable. |
| W14 stale cursor | FIXED | Typed `GIT_CONFLICT_CURSOR_STALE` code (`error.rs:220`), single restart, test present. No page cap, low. |
| W5 root reset | FIXED | The reset effect includes `root` (editor:204). |
| W17 tests | Partial | Hook test file exists (3 tests); transport test exists. See gaps below. |

## C3 status: OPEN. Not closable by a narrow patch.

- **History authority.**
  - The production authority is the store's full-text snapshot history (`transitions.ts`, coalesced at 500 ms). It is driven by a Ctrl+Z/Shift+Z/Y `addCommand` override and toolbar buttons that call `model.setValue`.
  - `JointHistoryAuthority` exists only in `lib/` and the Phase 01 browser test. Nothing in the production editor imports it. The browser test proves the Phase 01 concept, not the shipped editor.
  - Contract "one history authority" is satisfied by routing, not by construction. Native undo paths that bypass `addCommand` (touch, IME `historyUndo`) are unproven [INFERENCE].
- **Retained model lifetime.**
  - Models, view state and decision metadata are not retained. The editor disposes all three Monaco models on unmount (`editor:344-360`). `ConflictDraft` has no view-state field.
  - The store retains text and text-snapshot history only. Plan gate "hide disposes model" fails on a strict reading.
  - `MergeConflictEditor` is not mounted anywhere in the app, so `setVisible`, `selectDraft` and hide/reopen have no consumer. The WorkspacePage call is the controller only.
- **Prospective capacity / IME.**
  - `checkProspectiveEditGrowth` rejects before the store accepts the edit. At the Monaco layer it is post-hoc: Monaco has already applied the keystroke, then `executeEdits("capacity-guard")` rolls back (`editor:410-434`). This is not a public-API prospective guard. IME composition behaviour is unproven. No component test exercises the rollback.
  - `DEFAULT_MAX_*` (10 MiB / 2 MiB / 10 dirty) has no recorded Phase 01 measurement in what I read.
  - Plan step 10 says to stop the capacity gate if native typing/IME/paste cannot be guarded safely. That decision is not recorded.
- **Honest overclaims in docs.**
  - The phase file and plan.md say Phase 05 "retains … Monaco Undo/Redo across shell switches/hiding" and "wired terminal focus/handoff".
  - `terminalHandoff` and `refreshAfterTerminalReturn` have no production consumer (grep: only `BrowserDebugPanel`'s unrelated prop of the same name).
  - Both statements need correcting, and the status should not read Complete/100% while C3 and H1 are open.

## Findings

### High (blocking)

**H1. Accept actions can leave the display different from the store, and Apply sends the store text.**
`applyAccept` (editor:544-545) and `acceptAll` (editor:580) set `resultContentRef.current = next` before `model.applyEdits`.
The change handler then reads `previous = resultContentRef.current`, which is already `next`.

If the store rejects the update (history/draft budget; `updateResult` can also reject for recovery or a missing draft), the rollback `executeEdits` restores `previous`, which is `next`, so it is a no-op. The caller then runs `setResultContent(next)` unconditionally.

Result: the editor and the "All conflicts resolved" banner show text the store never accepted. `applyDraft` submits `draft.result`, which is the older store text. This is the "displayed ≠ submitted" case that the plan's revision fence exists to prevent. The behaviour is only reachable near the budget, but it silently stages different content than the user reviewed.

Fix: call `resolver.updateDraftResult` first, then sync Monaco under `isApplyingDraftHistoryRef`. Do not pre-assign `resultContentRef`. Test that after a rejection the store bytes, the displayed bytes, history and the Apply payload all match.

Related, same handler: the rollback `executeEdits` re-enters `onDidChangeModelContent` without a suppression flag. It terminates only because `draft.result === newText` short-circuits. If the draft is missing or retired, the rollback is rejected too and re-enters.

### Medium

1. **Same-snapshot recovery dead end.** Every non-`applied` outcome enters recovery, including `busy`, `failedBeforeWrite`, `unsupported`, and a plain network error (`transitions.ts:233-244`, `hook:554-560`). The snapshot key is then unchanged. `importRecoveryDraft` rejects `source.id === fresh.id` (store:234-240), so the user's only exits are copying text from the read-only result or discarding. Plan step 8 says "explicit refresh/review", which a same-snapshot review would satisfy. Decide intentionally (see questions).
2. **Eager inventory fetch on every workspace mount.** `WorkspacePage` calls `useConflictResolver(projectTargetInput)` and discards the result. The hook fetches the full conflict inventory and operation status for every target, conflicted or not. The editor mounts a second instance that repeats this. The page needs only the retire effect and the beforeunload guard. Split that out, and put the inventory behind a query enabled only while a draft or editor is active.
3. **Retire effect reruns on every keystroke.** The dependency `storeState.drafts` changes on every `notify()`. The effect rebuilds an owner Map and unsubscribes/resubscribes. Depend on a derived owner-key signature.
4. **Per-keystroke O(size) work.** `calculateDraftMetrics` re-encodes the result and the entire history; `checkProspectiveEditGrowth` encodes `newText`; `measureSourceBytes` encodes token by token. Keep incremental byte counters, and use `TextEncoder.encodeInto` or a UTF-8 length helper.
5. **Component handlers are not fenced after `await`.** `handleImportRecovery` and `handleMarkResolved` apply results (`setDraftKey`, `model.setValue`, `onResolved()`) after the await. They do not check that `filePath`, `root` or target is unchanged. A late import can put file A's text in file B's editor. A late apply can call `onResolved()` for the wrong selection. Only the `loadConflictDraft` effect has a cancel flag.
6. **Empty resolutions cannot be applied.** `allResolved` requires `resultContent !== ""` (editor:280). The early return treats empty `workdirContent` as "no conflict data" (editor:~731). An empty reviewed result can be valid. Likely pre-existing but now on the Apply path. Distinguish missing data from valid empty text.
7. **Post-import recovery bookkeeping.** The source recovery draft stays `isRecovery` after a successful import. It keeps counting toward the dirty limit and capacity, keeps `hasDirtyDrafts()` true, and the banner persists. This may be a deliberate safety choice (retain until explicit discard). If so, say so in the UI and docs. Otherwise release it after the fresh draft is applied.
8. **Test gaps against the plan oracles.**
   - Hook tests: 3. None cover `applyDraft` (late response, owner switch during await), `importRecoveryDraft`, `confirmFreshReview`, scoped refresh, `runOperation`, handoff or `beforeunload`.
   - Editor tests: 3. None cover import/confirm click flow, the capacity rollback, accept under budget, or the post-submit-typing message.
   - No Chromium test drives the real `MergeConflictEditor` with Monaco.
   - AC8/AC9 cross-server and CUT3 delayed-apply oracles are not exercised at hook/UI level, only in the store.

### Low

- No page or iteration cap in `fetchConflictInventory`; the server bounds it, so low.
- Source text also sits in the TanStack cache via `useGitConflictFile`. It is memory-only but outside draft capacity accounting and not cleared on discard/retire.
- `submittedTokens` is a third full result copy held per in-flight attempt, unaccounted in capacity. Revision divergence is detected by text compare, which is correct.
- `DraftOwnerScope`/`ConflictDraft` are still mutated in place and shared by reference in `getSnapshot().drafts` (earlier W16). Not changed, low while consumers rely on the store's notify.
- `matchesOwnerScope` compares `serverUrl` strictly while other hook paths normalize. Safe because both sides derive from the connection snapshot; keep consistent.

## Security
- Memory-only drafts; no logging or telemetry of source text; clean-only eviction. OK.
- Owner fencing is solid: apply, refresh, import and operations all re-check `isCurrentConnection` and server binding, and use `getApi(owner)` with the draft's own scope, so draft bytes cannot reach another server.
- Import refuses a different profile, server URL, project, worktree, root, path or repository root.
- Server `deny_unknown_fields` rejects malformed bodies and legacy `content`.
- Gap: H1 (display ≠ submitted) is an integrity issue, not a confidentiality one.

## Performance
Medium findings 2-4. Fine for typical files; the 2 MiB budget bounds the worst case.

## Architecture / YAGNI / KISS / DRY
- Good: draft key and scope helpers, store split into key/types/capacity/transitions, owner-qualified client, no new transport, mutation retry disabled.
- Overbuilt for the shipped surface: `setVisible`, `selectDraft`, `isPanelVisible`, `getDraft`, `terminalHandoff` and `refreshAfterTerminalReturn` have no production consumer yet (editor unmounted). Keep only if Phase 07/08 will use them; otherwise YAGNI.
- Duplicate responsibility: two hook instances each own inventory state, load-request counters and the beforeunload listener. Split registry/controller from inventory.
- Two history models coexist in the repo (store snapshots vs `JointHistoryAuthority`). Pick one before Phase 06.

## Positive
- C1 test asserts the real serialized HTTP body, not a mock.
- Retirement now follows connection invalidation, with a lazy double-check at Apply.
- `confirmFreshReview` re-fetches rather than trusting local state.
- Post-apply typing split is handled in both store and UI.
- Capacity: clean-only eviction, dirty-count refusal, prospective-growth check at the store.
- Rust stable cursor v2 and typed stale-cursor error code.

## Recommended actions
1. Fix H1 and add a rejection test covering store bytes, displayed bytes and the Apply payload.
2. Guard the capacity-guard rollback against re-entry.
3. Correct plan.md and the phase-05 file: reopen status ("Review: changes requested; C3 open"), remove the Monaco-undo-retained and terminal-handoff-wired claims, and record the C3 decision.
4. Resolve the same-snapshot recovery dead end (allow same-snapshot fresh review for `busy`/`failedBeforeWrite`, or document the exit).
5. Split the page-level registry controller from the inventory hook, and make inventory demand-driven.
6. Fence component handlers after `await`.
7. Add the missing hook/editor/browser tests.
8. Close C3 in Phase 06/07 with a decision: wire `JointHistoryAuthority` or formally keep store history, plus real retained models or an explicit amended contract, plus IME/paste qualification.

## Metrics
- Type check: clean (tester).
- Tests: 121 pass (tester). Coverage not measured.
- Lint: not run.

## Unresolved questions
1. Is the "Complete / 100%" status intended to cover C3, or should Phase 05 stay open until Phase 06/07 settle history authority, model retention and IME? If deferred, who owns it, and is the plan's stop-the-gate rule waived?
2. Is the 10 MiB / 2 MiB / 10 dirty limit backed by a Phase 01 measurement? Where is it recorded?
3. Should `busy`/`failedBeforeWrite` and transient transport errors force a fresh snapshot with a new key, or may the user retry on the same snapshot (the server precondition protects it)?
4. Should the source recovery draft be released after a successful import and apply?
5. What do callers of `onResolved` do (close the panel or refresh)? That sets the severity of the late-apply fencing gap.
6. Where will terminal handoff be consumed (WorkspacePage, terminal return hook), and who owns the Linux Tauri close-guard evidence?
