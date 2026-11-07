# OS session management — Code Review Cycle 2

## Score: 6/10 — changes required

**Cycle 1 critical issues are not all resolved.** Prompt isolation and minimized placement have meaningful corrections. Exact lifetime provenance, terminal authority revocation/resource identity, retained End lifecycle across all entry points, and qualification remain incomplete.

## Scope and evidence

- Selected plan: `plans/261104-1529-os-session-management-and-interactions/plan.md`; Cycle 1 comparison: `plans/reports/code-review-261104-2143-os-session-management-cycle-1.md`.
- Current inventory: 81 tracked changed files, +9,035/-1,191, plus untracked contracts/controllers/tests/reports. Behavioral review of server guard/reader/respawn changes, UI inventory/transport/action contracts, terminal panel/keepalive/resource placement, shell/Close/Hub/Review/Recipe and supporting unit/browser/E2E sections. Not a line-by-line certification of every changed fixture.
- Read README, PDR, code standards, active agent/development/primary guidance, code-review skill and selected P08 acceptance requirements.
- **Static review only; no commands building, testing, linting or formatting executed by this reviewer.** Separate Cycle 2 tester report `plans/reports/tester-261104-2229-cycle2-regression-verification.md:15-20` reports 112 PTY + 154 API + 3,182 UI tests passing; lint 0 errors / 317 warnings. These are attributed results, not independent runtime verification. Report explicitly excludes authenticated browser/live-PTY qualification (`:58-63`).
- Source, tests, plans and task state unchanged. Only this report created. Type/test coverage percentages unavailable; current full build/typecheck/browser/human acceptance not established here. Selected plan has no `qualification/` receipts in inspected inventory.

## Cycle 1 disposition

| Required correction | Cycle 2 disposition | Current evidence |
|---|---|---|
| 1. Canonical exact terminal authority | **Partial — MUST FIX** | Unsafe numeric equality fallback and incarnation-less adoption removed (`terminal-session-contract.ts:524-575`). Captured branch still skips canonical eligibility; ordinary launch lacks original generation/epoch provenance. C1. |
| 2. Dynamic adoption and authority-gated resize | **Partial — MUST FIX** | Latest target ref/binding token and initial resize guard added (`TerminalPanel.tsx:184-202,444-498,992-998,1375-1408`). Authority is not durably revoked on replacement; runtime lookup still aliases exact lifetimes. C2–C3. |
| 3. Prompt isolation and independent Close actions | **Corrected in inspected controller; regression evidence incomplete** | Immutable dispatch record plus latest request/token check prevents A's awaited result from replacing/dismissing B (`terminal-close-context.tsx:217-224,292-330`). Independent reconciliation uses exact bound target/window (`:82-137`). New test covers only one malformed-return/unknown path, not actual successful 202/200; C5. |
| 4. Monitor/Ports retained actions and typed errors | **Partial — MUST FIX** | Retained maps and unresolved-button guards added; failed/refused displayed immediately. Maps remain view-local; Ports never reconciles; frozen-target and visible-result ownership gaps remain. C4. |
| 5. Minimized placement and one-placement invariant | **Corrected in inspected transaction** | Removes all prior placements; sets destination, clears minimized/maximized/restorePlacement before insertion; no stale restore afterward (`window-store.ts:346-365,454-456`). Tile-minimized→float cross-desktop regression validates layout (`window-ops.test.ts:531-584`). Minimized float→float case still not explicitly covered. |
| 6. Qualification oracles and lifecycle observation | **Partial — MUST FIX acceptance blocker** | Real boundary DOM attributes now produced (`TerminalPanel.tsx:371-377`), slot lookup added (`terminal-session-observation.ts:161-175`), cascade now checks exactly 28px (`os-lifecycle.spec.ts:176-180`). Positive baselines, streaming output, physical bytes, both End origins/loss and real Review retirement still absent. C5. |

Unless explicitly rooted elsewhere, paths below start at `packages/ui/src/`.

## Critical issues — MUST FIX

### C1. Resolver still accepts insufficient lifetime authority
**High; ownership/security boundary; confidence high.**

References: `api/terminal-session-contract.ts:500-540,543-588`; `api/ws-transport.ts:91-96`; `os/OsShell.tsx:330-366,1453-1474`; `api/terminal-session-contract.test.ts:302-323`.

- Captured branch compares exact text but does not call `isTerminalInventoryRowEligible`. A row with exact `"42"` and safe numeric `43` still grants live/exited availability for captured `"42"`; canonical safe-disagreement rejection is bypassed. Owner comparisons are conditional on `obs.owner`, so null-owner observations can also satisfy that branch.
- Both branches infer missing typed state from `alive`. Decoder deliberately removes invalid `terminationState`, so malformed metadata can become actionable `live`, or automatic presentation-close `exited`, instead of unknown. The type cast also allows actual `terminationRequested` to escape an availability union that does not contain it.
- Ordinary views contain session ID/incarnation but no verified originating generation/epoch. Resolver accepts whichever observation first matches these fields. Both shell create paths publish numeric incarnation after await without checking the captured owner again. Safe integer equality does not prove original server lifetime; the same ID/incarnation under another generation/epoch can acquire that newer destructive target.

**Correction:** centralize the existing canonical row/owner checks; require non-null matching authority and exhaustive state mapping. Bind ordinary launch/attach adoption to proven originating owner/epoch, with post-await fencing; never acquire newer authority merely from numeric ID/incarnation equality. Add captured safe-disagreement/null-owner/invalid-state tests and held-create/new-epoch-before-first-adoption tests. Keep unsafe/unproven views Close-only.

### C2. Verified terminal authority is never durably revoked after replacement
**High; wrong-process input/resize risk; confidence high for dispatch paths.**

References: `components/organisms/TerminalPanel.tsx:245-250,265-275,495-503,649-657,776-797,920-923,953-997,1035-1038`.

A successful validation sets `isAuthorityVerified` true. Receiving another incarnation only sets `disableStdin` and returns; it does not revoke that flag or close the replay gate. Replay mismatch then calls `syncEffectiveStdinSuppression`, which computes from UI/replay state, not authority, and can immediately undo `disableStdin=true` on a previously ready stream.

`onData` and resize still see current connection + verified flag and dispatch to the raw session ID. Process-restarted notification also reopens the live gate without validating captured authority. History insertion (`writePanelInput`) and suggestion acceptance check connection currency but bypass the authority/replay predicates used by normal input. `isCurrent` checks binding token and connection generation, not target lifetime.

**Failure sequence:** verify/attach A → observe replacement B on the same transport/raw ID → mismatched output is rejected, but a subsequent resize or input/history action can still target B. Hiding mismatched output is not a mutation fence.

**Correction:** one durable authority-revocation path; all write/resize/attach/restart recovery routes share an exact-current-and-ready predicate. Never restore stdin from replay/UI state when authority is refused. Test successful baseline → mismatched incarnation → physical input/history/suggestion/resize/restart, not only initial mismatches. Preserve xterm during valid placement.

### C3. Exact resource claims still resolve to one raw-ID runtime
**High; architecture/ownership integrity; confidence high.**

References: `os/OsResourceHost.tsx:230-247`; `components/organisms/TerminalKeepAliveHost.tsx:65-86`; `os/apps/TerminalsApp.tsx:41-62,116-132`; `os/OsShell.tsx:1003-1066`.

Claims distinguish generation/epoch/incarnation, but mounted sessions are deduplicated by profile/raw ID, React keys use `terminalKey(profile,id)`, and visible slots retrieve terminals by that same raw key. An old captured window surviving reconnect/replacement and a newly opened exact target therefore pass different claims yet share one terminal entry. First-wins host dedup may keep the old refused binding; both successful slots can reparent the same DOM. New target may be unusable or display the older resource rather than receiving independent exact authority.

**Correction:** make runtime lookup and visible-slot admission agree with exact lifetime ownership. Keep valid same-lifetime placement stable without treating another lifetime as that renderer; refuse conflicting stale claims or retire the old binding explicitly. Cover old A window retained + new B same profile/raw ID/different epoch or incarnation, both visible, asserting exact binding and exclusive DOM placement. No new generic registry required.

### C4. Monitor and Ports retain actions only partially; independent lifecycle remains broken
**High; asynchronous destructive-action state; confidence high.**

References: `os/apps/SystemMonitorApp.tsx:275-308,455,537-571,895-896`; `components/organisms/PortsPanel.tsx:203-218,261-305,538-550,728-731`; `os/DesktopCanvas.tsx:40-52,58-59,95`.

- Both action maps live inside ordinary app components; minimized/inactive pane views unmount. Their unresolved records disappear on remount, permitting another request for that captured action. End state must outlive presentation, not just the current dialog.
- Ports has no inventory reconciliation at all. Lost response/202 remains unresolved forever in that mounted panel, even after exact exit/cancellation. Its guard derives `isUnresolved` from the current row target, while dispatch uses frozen `endTargetState`; a row target change can check B's state then redispatch unresolved A after the first request settles.
- Typed error state is retained but not restored into visible feedback. Monitor clears `killError` on reopening; Ports clears it and leaves outcome display in row-local state. Row disappearance/remount loses that feedback.
- Monitor still applies post-await results to singleton visible state without a prompt identity fence. Escape/backdrop can dismiss its dialog (`:896`) during an outstanding request despite disabled Cancel. Open B; completion A can set B's error or call `setConfirmKill(null)` (`:544-564`). Its unconditional action-result write can also overwrite a state already reconciled to completion, although the effect may later reconcile it again.

**Correction:** reuse the existing root retained-action lifecycle for all reachable End entry points, or move only the necessary exact records to an existing persistent owner. Reconcile live/pending separately; guard by the frozen target; render retained typed state on reopen; token-fence visible completions and never downgrade settled records. Tests: lost live/pending responses, exact reconciliation, row disappearance, minimize/restore, target-changing row, and Monitor held A → dismiss → B → complete A; assert mutation count stays one while unresolved.

### C5. Qualification still cannot establish promised behavior
**High acceptance blocker; not proof of a runtime product failure; confidence high.**

References: `packages/ui/e2e/os-session-management/os-session-management.spec.ts:42-85,98-176,179-220`; `packages/ui/e2e/fixtures/terminal-session-observation.ts:58-104,177-240,256-279,300-353`; `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:65-75`; `os/terminal-close-context.test.tsx:176-187`; selected `phase-08-integrated-qualification.md:18-24`.

- Physical oracle remains only a comment. Test launches the normal Dock terminal, never starts `stty`/`od`, never proves positive sentinels or absence of blocked bytes. Named surfaces still have optional assertions.
- End test clicks End but asserts only dialog disappearance: no 202/200 response/echo assertion, pending origin, lost response, request counts or origin-specific reconciliation.
- Review uses fabricated tuple and manually seeded cache instead of eligible live metadata. Seed keys do not match production `sessionChangesQueryKeys.files` ordering/shape (`api/session-changes-queries.ts:60-72`). Missing QueryClient explicitly succeeds (`spec.ts:74`). Frame Close does not purge these seeds either; tests can either bypass the assertion or fail without exercising actual protected-data behavior. Hidden/config retirement and held late results are not exercised.
- Observer now has real DOM tokens and slot mapping, but requires only a token. Creation/attach/replay completion and advancing live output are not positive baseline requirements. Epoch is the first global DOM attribute, not the target's; epoch/incarnation equality is optional when absent. Frames are still raw-ID-only, retain content-bearing `rawPayload` without bounds, and do not distinguish owner sockets.
- Close A/B regression resolves `{status, body}`, while `GuardedTerminationClient` returns a result body. This exercises unexpected-result/outcomeUnknown, not the claimed successful 202 path; no pending 200 coverage.

**Correction:** author the frozen P08 real authenticated oracles, fail/block on missing prerequisites, use real query factories/data, exact owner/session observations, mandatory positive lifecycle and byte controls, bounded content-free recording, both termination origins/loss, sibling preservation and hidden late-result retirement. Keep actual human review separately pending. Unit passes cannot replace this gate.

## Warnings — SHOULD FIX

1. **Arbitrary 500 becomes proven signal failure.** `lib/terminal-session-actions.ts:153-181`; `api/ws-transport.ts:3254-3286`. Only validated protocol `TERMINATION_SIGNAL_FAILED` establishes failed dispatch. Other 500s may follow a mutation; retain `outcomeUnknown`, not a retryable failed state. Validate refusal envelopes/codes as well instead of casting arbitrary strings.
2. **Destructive endpoint ignores JSON media type.** `server/src/api/terminal.rs:457-505`. Bounded `Bytes` extraction parses JSON even for text/plain/missing media type. Enforce application/json/415 alongside 512-byte bound. Protocol hardening; no demonstrated auth/CSRF bypass claimed.
3. **Stale shell layer closure.** `os/OsShell.tsx:247-309`. Handler reads palette/modal/nonmodal state but effect dependencies omit it; modal shortcut arbitration uses old state. Use current narrow dependencies/current-state callback and exercise real layers.
4. **Float projection hides right-side controls.** `os/window-ops.ts:130-139,151-160`; `os/WindowFrame.tsx:445-519`. X clamps to viewport minus 50/100 regardless of width; only a left sliver stays visible. Preserve reachable control strip in derived geometry without overwriting saved geometry.
5. **Recipe connection input remains wrong-shaped and frozen.** `os/recipes/RecipeEditor.tsx:85-111`; `os/recipes/recipe-source-context.ts:119,190-203`; `api/connections.ts:347-354`. Array snapshots are passed to an ID-keyed record, so connected profiles appear disconnected. Both profile/connection inputs are mount-only. This is also a static type incompatibility; UI build/typecheck was not run here. Use existing reactive subscriptions plus an ID map; preserve authored choices.
6. **Review status key omits requested epoch.** `api/session-changes-queries.ts:32-47,123-133,233-254`. Different expected epochs share a fresh status result/cancellation identity. Include expected authority in key and exact matching.
7. **Notification bell double-toggles.** `os/TopBar.tsx:319-326`; `os/OsShell.tsx:1565-1568`; `os/shell-input-context.tsx:85-90`. Child opens via provider; parent then toggles same state closed in the same event. Pick one owner; exercise actual shell/provider open and close.
8. **Frame/list Review Close bypasses exact purge.** `os/WindowFrame.tsx:267-286`; `os/WindowList.tsx:157-176`; `os/apps/SessionChangesApp.tsx:129-136`; `os/window-store.ts:121-125`. Only app Close/Escape cancels/removes target queries; generic close removes window only. No centralized cleanup in inspected close primitive; root retirement host stops observing a removed window. Route all presentation-close entry points through exact cleanup while preserving sibling identities.
9. **Hub promotes unavailable retained evidence.** `os/agent-hub.ts:284-299,330-350,388-393`; `stores/agent-status.ts:47-58,61-71`. Numeric join ignores status-view availability/current generation; reconnect-retained rows can become Working/Idle/ready before fresh baseline. Require current owner-qualified ready evidence.

## Suggestions — NICE TO HAVE

- **DRY/KISS:** one small exact target equality/eligibility helper and one existing retained action controller path. Current parallel Close/Monitor/Ports implementations have already diverged; do not add another service/runtime.
- **Memory bounds:** root Close retains every record/callback indefinitely (`os/terminal-close-context.tsx:67-78`); Monitor/Ports maps grow for component lifetime. Release settled/retired records safely, never evict unresolved actions merely on dismissal.
- **Avoid hot-path allocation:** `server/src/pty/manager.rs:795-804` builds String keys for every marker membership/removal, including inventory projection. Use allocation-free borrowed lookup/storage.
- **Delete dead compatibility:** `os/agent-hub.ts:403-438,725-749` retains test-oriented fake all-zero epoch construction/raw-ID fallback. Tests should exercise canonical authority rather than keeping a second production convention.
- Add minimized float→float cross-desktop regression alongside the existing minimized tile→float test, and dynamic target adoption assertions for outgoing writes/resize/attach/replay, not just xterm instance count (`TerminalPanel.test.tsx:1095-1137`).

## Positive observations

- Backend guard checks epoch, manager/replacement state and exact incarnation under existing lock ordering before signal/cancellation (`server/src/pty/manager.rs:2632-2719`). Fallible signalling does not stop the reader first (`server/src/pty/session.rs:301-337`).
- Restart validation failure publication is fenced against exact cancellation/reservation; no unnecessary new manager/service introduced.
- Latest-prompt token/ref correction directly addresses Cycle 1 A/B ownership, rather than suppressing feedback.
- Placement now clears stale restore state as part of destination transaction and validates single placement in regression coverage.
- Same-response inventory headers, exact-u64 fields, conservative downstream numeric proof and presentation-only Close remain useful architecture foundations.

## Recommended action order

1. Fix exact originating authority and durable terminal mutation fences/runtime identity (C1–C3).
2. Finish shared retained lifecycle and prompt/error ownership across Monitor/Ports (C4).
3. Repair P08 oracles and regression doubles (C5); then Main owns serialized typecheck/build, targeted unit/browser and real authenticated PTY qualification. Preserve first failures and missing-prerequisite status.
4. Correct warnings before claiming all selected interaction requirements complete; human acceptance remains a separate gate.

## Unresolved evidence

No independent full UI/E2E typecheck/build, browser/real-PTY journey or human acceptance from this reviewer. Existing tester results are scoped passes only. No claim that every plan task, P08 or P09 is complete. No unresolved product-choice question; remaining uncertainty is runtime/acceptance evidence.
