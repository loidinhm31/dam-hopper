# OS session management — Code Review Cycle 1

## Score: 5/10 — changes required

Cycle 0's eight blockers are **not all resolved**. Modal registration and hidden Review disablement have concrete corrections; exact terminal authority, asynchronous End ownership, minimized placement and meaningful qualification remain incomplete.

## Scope and evidence

- Plan: `plans/261104-1529-os-session-management-and-interactions/plan.md`; frozen architecture C1–C5 and P08 qualification requirements. Compared against `plans/reports/code-review-261104-2001-os-session-management.md`.
- Inspected changed production paths in `server/src/api/{router,terminal}.rs`, `server/src/pty/{manager,fleet_state,session}.rs`; UI terminal contracts, transport/client/queries, aggregate/ports/terminal-manager hooks, terminal replay/input/panel/keepalive, OS shell/Hub/Close/Review/Recipe, window placement/claims/persistence/deep links and supporting regression/browser/E2E sections. Read README, PDR, code standards, active development/primary workflows and code-review skill.
- Working inventory: 80 tracked changed files, 8,674 additions / 1,165 deletions, plus untracked contracts/controllers/qualification files. Reviewed behavioral paths and relevant tests, not a line-by-line certification of every test fixture.
- Static review only: **no checks executed by this reviewer**. Separate tester report `plans/reports/tester-261104-2138-regression-verification.md:15-20` reports 112 PTY tests, 154 API tests and 3,173 UI tests passing; lint reports 0 errors / 315 warnings. Those are attributed results, not independent runtime verification here. No current authenticated browser/real-PTY/human acceptance demonstrated by this review.
- No source/test/plan/task-state changes. Only this report created; plan statuses intentionally unchanged under review ownership constraints.

## Cycle 0 disposition

| Original issue | Cycle 1 disposition | Evidence |
|---|---|---|
| C1 Modal registration loop | Corrected in inspected code | Stable callback `shell-input-context.tsx:97-105`; narrow dependencies in `CommandPalette.tsx:70-77`, `TerminalCloseDialog.tsx:35-43`, `ServerProfilesDialog.tsx:132-145`, `ServerSettingsDialog.tsx:132-145`. Provider regression in `shell-input-context.test.tsx:73-108`. |
| C2 Generation / PTY authority | Partial; still MUST FIX | Initial captured-target generation/epoch checks added, but target adoption is invisible to mounted callbacks, exact identity still has numeric bypasses, and resize is not authority-gated. Findings M1–M2. |
| C3 Hidden Review config retirement | Corrected in inspected code; live late-result evidence still absent | Root `ReviewRetirementHost` mounted at `OsShell.tsx:1552`; guard now observes owner config and strips tuple on disable (`review-retirement.tsx:50-59,75-99,142-147`). Minimized disable/re-enable test `review-retirement.test.tsx:118-161` mocks query operations, so does not prove held-request cleanup. |
| C4 Ordinary terminal Close authority/state | Partial; still MUST FIX | Inventory resolver used by frame/list and shell adoption, but unsafe or missing lifetime evidence can acquire a newer target. Finding M1. |
| C5 Placement raw-ID/remount | Original matching/remount defects corrected statically; continuity not qualified | Handler now uses exact matcher (`OsShell.tsx:1003`); matcher reads producer's `appState.target` (`agent-hub.ts:184-203`); keepalive key stays stable (`TerminalKeepAliveHost.tsx:65-86`). Stable key exposes unfenced authority adoption in M2; full lifecycle proof absent in M6. |
| C6 End single-shot / request ownership | Partial; still MUST FIX | Independent action records added, but async completion still sees stale prompt and Monitor/Ports still redispatch unresolved actions. Findings M3–M4. |
| C7 Floating source placement | Partial; still MUST FIX | Source removal added (`window-store.ts:346-349`), but minimized floating moves restore old placement after insertion. Finding M5. |
| C8 Qualification authoring | Not resolved | Fake token fabrication removed and End click added, but real byte, response-loss, sibling/retirement and exact continuity oracles remain absent/broken. Finding M6. |

Paths in the table are under `packages/ui/src/` unless a different root is given. “Corrected” describes inspected implementation, not runtime acceptance.

## Critical issues — MUST FIX

### M1. Window authority resolution still admits the wrong exact lifetime
**High; security/ownership boundary; confidence high.**

References: `packages/ui/src/api/terminal-session-contract.ts:500-557`; `packages/ui/src/os/OsShell.tsx:82-126,330-365,1453-1474`; `packages/ui/src/os/persistence.ts:43-48`.

- Captured-target matching accepts `row.incarnationExact === captured` **OR** matching legacy numeric evidence. Thus a disagreeing or removed malformed exact field can still be accepted through the numeric branch. It also infers lifecycle state from `alive` if the typed state is absent (`:531`).
- Ordinary-window matching explicitly falls back to `row.incarnation === winIncarnation` after `proveNumericEvidenceJoin` fails (`:545-554`). Two different exact u64 identities that round to the same JS number therefore pass. `createTerminalTargetFromObservation` then constructs a valid target for the **new row**, not proof that this window owns that row.
- No stored incarnation means raw-ID adoption. Restored terminals intentionally retain only session ID/cwd, and launch paths store only numeric incarnation without original generation/epoch or a post-create owner fence. A later observation can promote an old/unverified view into current destructive authority.

**Impact:** frame/list can offer End for a replacement session rather than the lifetime represented by the original view. Backend CAS correctly protects the newly supplied tuple, but cannot detect the UI selected the wrong tuple.

**Correction:** apply canonical exact/no-fallback rules consistently; reject exact disagreement/malformed/missing authority. Bind ordinary views to their actual originating owner and proven attach/creation lifetime before adoption. Do not promote unsafe numeric equality or restored raw IDs into authority. Cover adjacent unsafe-u64 identities, exact/legacy disagreement, malformed exact and held create across generation/epoch change.

### M2. Adopted authority never reaches the already-mounted terminal transport callbacks
**High; security/continuity boundary; confidence high.**

References: `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:65-86`; `packages/ui/src/os/OsShell.tsx:82-126`; `packages/ui/src/components/organisms/TerminalPanel.tsx:312,429-464,936-979,1081-1092,1358-1389,1420-1424`; `packages/ui/src/os/OsResourceHost.tsx:230-247`; `packages/ui/src/os/apps/TerminalsApp.tsx:116-125`.

The stable raw profile/session React key preserves xterm, but the entire transport-binding effect captures `terminalTarget` only at mount. The effect dependencies omit that target. A normal dock-created panel mounts without it; shell inventory adoption later changes props without replacing the closure. Input/reconnect handlers consequently retain the unqualified branch and can bind/write through a later generation/epoch despite the window now advertising captured authority. Two distinct targets sharing profile/raw ID are also deduplicated and attached through that same raw-key resource.

Even a panel initially mounted with a target registers an unguarded resize callback and schedules fit before inventory validation (`TerminalPanel.tsx:975-979,1081-1083`); a refused epoch must not resize the raw-ID replacement.

**Correction:** preserve the xterm instance while making transport authority current, immutable per verified lifetime and independently fenceable. Explicitly adopt/revalidate without remount/attach/replay during placement; retire stale binding rather than silently borrowing a replacement. Gate resize as well as attach/render/input. Test undefined→verified authority adoption, same raw-ID replacement, reconnect, and placement with outgoing-write/resize assertions and actual lifecycle counters.

### M3. Held End response A can still overwrite or dismiss prompt B
**High; async state corruption; confidence high.**

References: `packages/ui/src/os/terminal-close-context.tsx:132-160,172-178,266-305`.

After `await requestGuardedTermination`, the comparison at `:275` and dismissal at `:298` read the **captured** `currentRequest` from A's callback. Comparing it to A's target is always true even after Cancel opens B. Independent records correctly bind A's window callback, but do not protect B's visible state: A's 202/unknown result replaces B's state; A's pending-origin 200 also closes B's prompt.

**Correction:** keep action-record updates independent; condition visible prompt updates on the latest prompt/action identity, not the dispatch closure. Bind visibility/completion to an immutable prompt token or current request ref. Regression: hold A → dismiss → open B → resolve A for both 202 and 200; B's state, target, visibility and dispatch eligibility must remain unchanged.

### M4. Monitor and Ports still allow redispatch of an unresolved End
**High; destructive-action lifecycle; confidence high.**

References: `packages/ui/src/os/apps/SystemMonitorApp.tsx:461-491,805-806,868-873`; `packages/ui/src/components/organisms/PortsPanel.tsx:242-270,502-515,585-590`; `packages/ui/src/hooks/use-ports.ts:465-505`.

Monitor handles `outcomeUnknown` only as an error string, then clears `killPending`; its End button becomes enabled again. It drops acknowledged live action state on success. Ports now displays unknown outcome, but that state never disables confirmation; after `isKilling` clears, the same captured request can be sent again. Neither path retains origin-qualified reconciliation independently of dialog visibility. Ports also closes the dialog on a typed `failed` result instead of displaying failure (`:253-260`).

**Correction:** route reachable End controls through one consistent retained-action lifecycle. Never redispatch unresolved captured actions; reconcile live only on exact exit and pending only on exact cancellation. Preserve unknown state across dismissal/reopen and row disappearance; display failed/refused distinctly. Assert one outgoing mutation for held/lost responses in all entry points.

### M5. Minimized terminal Move beside a floating Hub recreates stale/duplicate placement
**High; layout integrity; confidence high.**

References: `packages/ui/src/os/window-store.ts:346-353,404-438`; `packages/ui/src/os/window-ops.ts:618-625,643-674`.

For an existing minimized terminal, `winToPlace` retains `minimized:true` and its source `restorePlacement`. The floating branch inserts its ID in destination B. The final `restoreWindow` then uses `restorePlacement.desktopId/mode/bounds` from source A, changes the window back to A and inserts it there—without removing the newly inserted reference in B. A minimized tile can likewise regain its old tiled placement instead of landing beside the floating Hub.

**Correction:** normalize minimized/restore placement as part of the destination placement transaction, or restore before removing/moving; do not invoke stale restoration after destination insertion. Cover minimized float→float and tile→float across desktops; assert the owning desktop and exactly one tree/float reference after the move.

### M6. Qualification still does not establish the promised safety behavior
**High acceptance blocker, not runtime proof of a product failure; confidence high.**

References: `packages/ui/e2e/os-session-management/os-session-management.spec.ts:24-56,68-77,104-146,149-190,249-285`; `packages/ui/e2e/fixtures/terminal-session-observation.ts:158-208,245-249,284-342`; `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:65-80,167-179`; `plans/261104-1529-os-session-management-and-interactions/phase-08-integrated-qualification.md:18-24`.

- Physical oracle remains only a `stty`/`od` comment. The test opens a normal shell and checks surfaces; no hex output, positive sentinels or blocked-byte comparisons. Optional surfaces still skip assertions.
- Review uses hard-coded tuple data and checks window mount/close. It exercises no eligible captured data, sibling cache preservation, hidden retirement or held late response.
- End is now actually clicked, but there is no assertion of 202 vs 200, pending restart, lost response, reconciliation origin or single-shot request counts.
- Lifecycle passes **window ID** to `snapshot`, whose diagnostics filter expects **session ID**. Its DOM fallback also has no matching attribute producer in `packages/ui/src`. This blocks a real baseline rather than establishing continuity. Even after fixing that mapping, positive creation/attach/replay baselines and advancing output are not required; epoch/incarnation assertions remain conditional. Epoch reads the first global attribute rather than exact target authority, and WS records remain raw-ID scoped and unbounded/content-bearing.
- Cascade assertion accepts every nonnegative distance (`delta === 0 || delta === 28 || delta > 0`), so it cannot reject wrong spacing.

**Correction:** implement the frozen P08 real authenticated oracles. Required setup must fail/block, never optional-pass. Resolve window→exact owner/session authority, require completed positive baselines and streaming output, use bounded content-free observations, and exercise actual byte isolation, both End origins/loss, sibling and hidden retirement. Preserve actual human acceptance as a separate unfulfilled gate.

## Warnings — SHOULD FIX

1. **Arbitrary HTTP 500 is mislabeled as proven signal failure.** `packages/ui/src/lib/terminal-session-actions.ts:171-181`; `packages/ui/src/api/ws-transport.ts:3254-3286`. Validate the matching protocol error code/envelope before declaring `TERMINATION_SIGNAL_FAILED`; otherwise retain `outcomeUnknown`. Particularly dangerous when failed state re-enables End.
2. **Destructive endpoint still accepts JSON bytes under any media type.** `server/src/api/terminal.rs:457-505`. Enforce JSON Content-Type/415 while retaining the 512-byte bound. Contract hardening; no demonstrated authentication/CSRF bypass claimed.
3. **Shell shortcuts still capture stale layer state.** `packages/ui/src/os/OsShell.tsx:247-309`. Reads palette, modalDepth and activeNonmodal while omitting them from dependencies. Use current narrow dependencies/current-state event logic; exercise real modal/nonmodal shortcuts.
4. **Float projection keeps a left sliver visible, not right-side controls.** `packages/ui/src/os/window-ops.ts:130-139,151-160`; `packages/ui/src/os/WindowFrame.tsx:445-519`. Maximum x ignores window width, allowing Close/Maximize off-canvas. Clamp derived display geometry to keep the control strip reachable while preserving saved bounds.
5. **Recipe connection input is wrong-shaped and frozen.** `packages/ui/src/os/recipes/RecipeEditor.tsx:85-111`; `packages/ui/src/os/recipes/recipe-source-context.ts:119,190-203`; `packages/ui/src/api/connections.ts:347-354`. Array snapshots are passed to an ID-keyed record and both profile/connection reads are mount-only. Connected sources appear disconnected and profile changes do not update labels/options. Use existing reactive subscriptions plus an ID map, without resetting authored choices.
6. **Review status key still omits expected epoch.** `packages/ui/src/api/session-changes-queries.ts:32-47,123-133,213-255`. Requests differing in expected server epoch share fresh status and cancellation identity. Include request authority in the key and targeted matching.
7. **Notification bell toggles the same state twice.** `packages/ui/src/os/TopBar.tsx:319-326`; `packages/ui/src/os/OsShell.tsx:1547-1548,1565-1568`; `packages/ui/src/os/shell-input-context.tsx:85-90`. Child sets notification open then parent updater toggles it closed in the same event. Choose one state-transition owner. Test both opening and closing through the actual shell/provider, not optional visibility checks.
8. **Frame/list Review close bypasses exact cache purge.** `packages/ui/src/os/WindowFrame.tsx:267-286`; `packages/ui/src/os/WindowList.tsx:157-176`; `packages/ui/src/os/apps/SessionChangesApp.tsx:129-136`; `packages/ui/src/os/window-store.ts:121-125`. Only the app's own Close/Escape path invokes targeted removal. Frame/list directly removes the window; cached protected data is not explicitly purged. Reuse exact close cleanup without owner-wide sibling eviction. Request cancellation on unmount does not itself erase cached content.
9. **Inventory-first Hub promotes retained unavailable agent evidence to current.** `packages/ui/src/os/agent-hub.ts:284-299,330-350,388-393`; `packages/ui/src/stores/agent-status.ts:47-58,61-71`. The store deliberately retains rows as unavailable during reconnect; Hub's new direct join checks numeric identity but not status-view generation/availability, then synthesizes Working/Idle and ready from connection state. Require current owner-qualified ready evidence; preserve Unavailable until the fresh baseline arrives.

## Suggestions — NICE TO HAVE

- **DRY/KISS:** use one small exact-target equality/eligibility predicate across resolver, placement and Close completion; retain one state-machine path rather than parallel Monitor/Ports variants. No additional service/registry required.
- **Bound retained action memory:** `terminal-close-context.tsx:66-83,206-212` retains every action and callback for the shell lifetime. Remove settled/retired records when safe, while never evicting unresolved actions merely because a dialog closes.
- **Avoid inventory hot-path allocation:** `server/src/pty/manager.rs:795-804` allocates a String for membership/removal. Use allocation-free borrowed lookup/storage.
- **Remove test-only production compatibility seams:** `agent-hub.ts:403-438` fabricates an all-zero PTY epoch; `:725-749` retains raw-ID matching “for legacy tests.” `validateAgentHubJump` has test-only callers in the inspected source search. Test real contracts; remove dead authority constructors/fallbacks rather than preserving a second convention.

## Positive observations

- Backend exact epoch/incarnation/replacement checks precede mutation under existing persistence/inner lock order; signal request and restart cancellation remain distinct (`manager.rs:2632-2719`).
- Guarded signalling does not fabricate exit or preemptively stop the reader; pending cancellation remains attached to its retained exact tombstone.
- Existing web kill/remove channels were removed rather than kept as unsafe fallback aliases; Close remains presentation-only.
- Recipe explicit source/context projection, exclusions and command-value confirmation are present without expanding the executor scope.
- C1's narrow callback dependencies and C3's root hidden-window guard are meaningful corrections, not warning suppression.

## Recommended validation handoff

Repair M1–M6, then Main owns serialized checks against the integrated tree: targeted Rust guard/race tests, UI typecheck/unit/browser, E2E typecheck, lint/build, and corrected authenticated real-PTY P08 journeys. Add held A/B prompt isolation, unsafe-u64 window adoption, target-prop adoption without xterm recreation, and minimized float Move-beside regressions. Preserve initial failures and attribute prior tester results; unit passes do not replace physical bytes/lifecycle counters or human full-app review.

## Unresolved evidence

Current full build/typecheck/browser/E2E/real-PTY and actual human acceptance were not independently exercised here. Selected plan has no qualification receipt directory in the inspected tree. Type/test coverage percentages unavailable. No claim that all plan tasks or P08/P09 gates are complete.
