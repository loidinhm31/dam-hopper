# OS session management implementation review

## Score: 4/10 — changes required

Static review of the uncommitted implementation against `plans/261104-1529-os-session-management-and-interactions/plan.md` and C1–C5. This is not runtime qualification or human acceptance. Findings reference inspected snapshots; subsequent coordinator repairs require their own validation.

## Scope and evidence

- Reviewed changed production paths in `server/src/api/{router,terminal}.rs`, `server/src/pty/{manager,fleet_state,session}.rs`; UI API contracts/client/transport/queries; aggregate sessions, terminal-manager and ports hooks; terminal replay/input/keepalive/panel; OS Hub/Review/Recipe adapters, shell surfaces, frames/list, placement/store, claims, persistence and deep links. Inspected supporting unit/browser/E2E changes and qualification reports; not a line-by-line certification of every test fixture.
- Change inventory: 80 tracked changed files, approximately 8,200 additions / 1,139 deletions, plus untracked contract/action/UI/E2E files. Existing plans and unrelated pre-existing defects are not repair authority.
- Read README, PDR, code standards, installed development/primary workflows, code-review skill, plan, architecture contracts and P08 acceptance requirements.
- No source, tests or task-state edits; no builds/tests/linters executed. Final validation belongs to Main. Historical evidence: `plans/reports/tester-261104-1936-verification-suite.md:10-15` records UI units/build/lint passing at that checkpoint and two Rust failures; source changed afterward. Those results do not qualify the current tree. Browser/real-PTY/human gates remain unproven here.
- Base HEAD: `258efdb9a48fc3ec54e7129aeb1df8914b29fc95`. Inspected-file SHA-256 checkpoints: `TerminalPanel.tsx` `72549f31856245c3323aaa7d8d7bcb4a883723f3a0e5be138cb65841d19c1b74`; `shell-input-context.tsx` `041c5de0c5d3353f68ebb0dd1dd6dbb39c7b3d92d78577c721354c0f9dcb8ad5`; `terminal-close-context.tsx` `832402d4ad96c3da7fbd76e743664bf5beef46b632ca365baf74d4becdbdd94b`; `review-retirement.tsx` `5dddb33f3cb02fe91b1693c8596c0e7b9bacdd238beaef3a0872f93f65968a2c`; `window-store.ts` `2e1f163de2ea56ddad2a89b532744c63755eb7376af4ee6ed619394c930115be`.

## Critical issues — MUST FIX

### C1. Opening registered modals creates a self-sustaining render/effect loop
**High; confidence high.**

References: `packages/ui/src/os/shell-input-context.tsx:97-105,119-142`; `packages/ui/src/os/TerminalCloseDialog.tsx:39-43`; `packages/ui/src/os/CommandPalette.tsx:82-86`; `packages/ui/src/components/organisms/ServerProfilesDialog.tsx:140-150`; `ServerSettingsDialog.tsx:142-152`.

Registration updates `activeModalTokens`, which changes the context object. Consumer effects depend on that entire object, so each registration triggers cleanup/unregistration followed by another registration. The token changes on every cycle. Palette, Close, Profiles and Settings can repeatedly render/register rather than remain usable; nested confirmations compound it.

**Correction:** depend on the stable `registerModalMount` callback, not the changing context value; preserve one balanced registration per actual mount/open lifecycle. Cover opening, nesting, closing and Strict Mode with the real provider, not standalone fallback mounts.

### C2. Captured terminals can bind to a different generation/PTY authority
**High, security/ownership boundary; confidence high for missing fence.**

References: `packages/ui/src/components/organisms/TerminalPanel.tsx:421-447,704-710,1047-1060,1115-1124,1177-1185`.

Binding selects the current profile snapshot without comparing `terminalTarget.generation`. Initial and recovery membership checks use legacy arrays and raw terminal ID. Replay checks only the numeric incarnation, not the captured PTY epoch. Therefore the shown binding path admits a replacement with the same raw ID/incarnation across generation/epoch changes; a matching replay can reopen stdin on that replacement. The same-response epoch decoder used by inventory is bypassed at this boundary.

**Correction:** fail closed against captured owner and original target authority before attach, rendering, resize or writes. Use the typed observation at initialization/reconnect and prove the exact tuple; do not silently replace captured generation/epoch. Add same-ID/same-incarnation/new-epoch and retired-generation tests with outgoing-write assertions.

### C3. Config-disable does not retire hidden Review identities
**High, protected-data lifecycle; confidence high.**

References: `packages/ui/src/os/review-retirement.tsx:96-131`; `packages/ui/src/os/apps/SessionChangesApp.tsx:115-127`; `packages/ui/src/os/DesktopCanvas.tsx:40-52,95`.

The root retirement guard subscribes only to connection/profile changes and never reads tracking configuration. The visible app may purge queries when disabled, but does not strip its target. Minimized/inactive-pane/other-desktop viewers need not mount, so their protected tuples remain in the window store after tracking is disabled and can become eligible again on re-enable.

**Correction:** observe the existing owner-qualified config state at the root retirement boundary and retire all matching windows on disable, including hidden ones. Strip tuple/runtime eligibility and cancel/purge protected queries with late-result fencing. Test disable while hidden and while requests are held, then re-enable without resurrecting old authority.

### C4. Ordinary terminal views never acquire the authority required by the new Close UI
**High, feature incomplete; confidence high.**

References: `packages/ui/src/os/OsShell.tsx:267-317`; `packages/ui/src/os/apps/TerminalsApp.tsx:73-102`; `packages/ui/src/os/WindowFrame.tsx:265-284`; `packages/ui/src/os/WindowList.tsx:152-177`.

Normal terminal creation/explicit launch stores raw session ID and numeric incarnation, not a verified `TerminalTarget` or observed termination state. Frame/list Close resolves only `runtimeIdentity.target` / `appState.target`, so ordinary launched terminals offer disabled End despite a capable server. For qualified Hub-opened views, no live inventory state is published to `appState.terminationState`; fallback labels every captured target `live`, including an exact pending restart or exited session.

**Correction:** resolve each view against its actual owner-qualified inventory observation, preserving exact lifetime identity; feed live/pending/exited/unknown state into the shared Close controller. Do not infer liveness from target presence or borrow a newer epoch for an old row. Cover dock-created, explicit-launched, restored and Hub-opened views.

### C5. Placement still raw-ID matches and can recreate xterm during Move beside
**High, identity/continuity; confidence high.**

References: `packages/ui/src/os/OsShell.tsx:954-975,1051-1065`; `packages/ui/src/os/agent-hub.ts:149-205`; `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:65-75`.

The intent handler falls back to profile + raw terminal ID for windows without captured authority, while Hub matching correctly refuses that inference. This can select an older/unverified view. Move beside then adds a captured target to such a window, changing the keepalive React key from `terminalKey(ref)` to the full tuple. That transition unmounts/remounts `TerminalPanel`, contrary to SAME xterm / ZERO attach/replay/reset. The Hub appState fallback also reads `terminalTarget`, while producers use `target`.

**Correction:** unify qualified matching and window-authority adoption; remove raw-ID selection. Establish authority without changing the mounted resource instance during a placement transition. Exercise an ordinary created terminal through Hub placement with actual creation/disposal/attach/replay counters.

### C6. End is not single-shot, and unresolved action ownership can move to another prompt
**High; confidence high.**

References: `packages/ui/src/os/TerminalCloseDialog.tsx:52-54,218-220`; `packages/ui/src/os/terminal-close-context.tsx:149-178,198-204,251-258,91-116`; `packages/ui/src/os/apps/SystemMonitorApp.tsx:469-488`; `packages/ui/src/components/organisms/PortsPanel.tsx:251-259,500-515`.

End re-enables for `outcomeUnknown` / `failed` / `refused`, permitting another dispatch for the same captured action. Dismissal and a second Close overwrite the singleton request/callback/window refs while the first request is still in flight. When the first response returns, it overwrites the second prompt's state. In the live reconciliation branch, window matching uses the *current request*, not the action being reconciled, so a first action's exit can close the second view. Monitor drops acknowledged action state; Ports hides unknown outcome and clears it on reopening. Neither retains origin-specific reconciliation.

**Correction:** retain each dispatched immutable action independently of prompt visibility; bind completion and callbacks to that action's exact target/window; never redispatch an unresolved captured action. Apply the same lifecycle semantics to all reachable End controls. Test held response A -> dismiss -> prompt B -> release A, and lost live/pending responses.

### C7. Floating Move beside leaves stale source placement
**High, layout corruption; confidence high.**

Reference: `packages/ui/src/os/window-store.ts:345-356,397-425`.

The floating branch changes the window's `desktopId` and appends to the destination floating list without removing the ID from its prior tree/floating list or repairing source focus. Cross-desktop Move beside leaves source placement referencing a destination-owned window. A tiled window moved beside a floating Hub can remain in both tree and float placement. This violates exactly-one-placement and risks duplicate slots/claims and invalid persisted layouts.

**Correction:** reuse the existing removal/move primitives before destination placement, preserving unrelated topology and resource instance. Cover tile->float, float->float and cross-desktop moves with layout invariants.

### C8. Qualification authoring can pass without exercising the promised safety behavior
**High, acceptance gap; confidence high.**

References: `packages/ui/e2e/os-session-management/os-session-management.spec.ts:35-87,100-110,170-178,181-213`; `packages/ui/e2e/fixtures/terminal-session-observation.ts:168-218,256-270,311-364`; `packages/ui/src/lib/terminal-buffer-replay.ts:71-80`.

- Review test conditionally calls `window.__damhopperDispatchIntent`; repository search finds no production definition. Missing hook skips assertions. No sibling or retirement scenario is actually exercised.
- Physical-byte test comments the `stty`/`od` command but only clicks the Dock and checks surfaces; it never launches that oracle or compares allowed/blocked bytes.
- 200/202/loss/retry test only opens and cancels Close; it never dispatches End.
- Observer fabricates `dom-token-*`, accepts zero lifecycle baselines, skips null epoch/incarnation checks, and uses substring/unidentified-frame matching. It reads epoch storage keys with no production writer.
- Reset diagnostics contain `instanceToken`, not session ID; session-first filtering discards them, allowing reset count to stay zero even after reset.

**Correction:** implement the P08 behavioral oracles using real authenticated setup and exact observation identity. Required setup must fail/block explicitly, not conditionally bypass checks. Require positive lifecycle baselines and advancing live output, real epoch/incarnation, token-linked resets, bounded content-free observations, and actual sibling/retirement/held-response checks. Do not add a production test-global bypass to accommodate these tests.

## Warnings — SHOULD FIX

1. **500 does not prove signal failure.** `packages/ui/src/lib/terminal-session-actions.ts:171-181` labels every HTTP 500 `TERMINATION_SIGNAL_FAILED`, although transport accepts any error code/body (`api/ws-transport.ts:3254-3286`). A proxy or unrelated server 500 may follow a successful destructive request. Only validated matching protocol failure proves signal dispatch failed; otherwise retain `outcomeUnknown`. Confidence high.
2. **Missing JSON media-type enforcement.** `server/src/api/terminal.rs:457-505` extracts `Bytes` and parses JSON irrespective of `Content-Type`; router protections do not add a media-type gate. Text/plain/missing-media requests reach the destructive handler, contrary to the frozen wire contract. Preserve bounded body handling but enforce application/json before mutation; test 415 cases. This is a protocol hardening finding, not a demonstrated authentication/CSRF exploit. Confidence high.
3. **Shell shortcut handler captures stale layer state.** `packages/ui/src/os/OsShell.tsx:197-259` reads `isPaletteOpen`, `modalDepth`, `activeNonmodal` but omits them from dependencies. Layer-aware arbitration can run against mount-time values. Use current narrow dependencies or a current-state event callback; cover cycle/palette shortcuts while each real layer is open. Confidence high.
4. **Projected float bounds hide right-side controls.** `packages/ui/src/os/window-ops.ts:130-139,151-160` allows x at viewport width minus 50/100, independent of the window width. Controls sit at the right of the frame (`WindowFrame.tsx:445-519`). A left sliver is reachable while Close/Maximize can be outside the clipped canvas. Constrain derived display bounds to preserve the control strip without destructively rewriting saved geometry; cover far-right floats and shrink/widen. Confidence high.
5. **Recipe connection metadata is wrong-shaped and nonreactive.** `packages/ui/src/os/recipes/RecipeEditor.tsx:85-111` freezes profiles/connections on mount and passes `ConnectionSnapshot[]` (`api/connections.ts:347`) to a projection expecting `Record<string, ConnectionSnapshot>` and indexing by profile ID (`recipe-source-context.ts:119,190,202-203`). Connected sources are marked disconnected; edits/reconnections/profile removal do not refresh labels/options. Build an ID map from existing reactive connection/profile subscriptions; preserve deliberate source/context/command choices. Confidence high.
6. **Review status cache omits expected epoch.** `packages/ui/src/api/session-changes-queries.ts:32-47,213-255` supplies `expectedServerEpoch` to the request but not its cache key. Two protected targets differing in epoch share fresh status data and request authority. Include the expected authority in status query identity and corresponding targeted purge matching. Confidence high.

## Suggestions — NICE TO HAVE

- **DRY/KISS:** factor exact target equality and the shared Close completion predicate. `terminal-close-context.tsx:91-145,260-278` repeats long identity checks and currently permits action/request mismatch. Prefer one small pure comparison/controller path; avoid another registry/service.
- **Performance / maintainability:** `server/src/pty/manager.rs:795-804` allocates `id.to_string()` for every marker lookup/removal, including per-row inventory projection. Use an allocation-free lookup structure/borrowed key. Consolidate unused seam-only helpers after caller audit; split large Recipe/Hub adapters around actual domain boundaries rather than introducing parallel state authorities.

## Positive observations

- Manager UUID authority, strict positive-u64 exact strings and same-response inventory metadata address the original destructive raw-ID hazard.
- Backend guard checks epoch/replacement/incarnation under existing lock ownership before signalling or exact restart cancellation; success distinguishes 202 signal request from 200 cancellation.
- Unsafe downstream numeric joins fail closed; headerless servers remain readable; legacy web kill/remove channels were removed rather than retained as unsafe fallbacks.
- Recipe capture uses explicit source/context projection, visible exclusions and value-bound command confirmation; Review persistence strips protected runtime authority.

## Recommended validation handoff

Main should first repair the blockers, then run the plan's owner-serialized Rust, UI typecheck/unit/browser/build/lint gates once against the integrated tree. The corrected authenticated journeys must prove physical PTY bytes, actual xterm/attach/replay/reset continuity, both restart admission orders, response loss, exact owner/epoch rebinding and hidden Review retirement. Preserve initial failures; do not count conditional/DOM-only assertions as qualification. Actual human full-app acceptance remains separate.

## Unresolved evidence

Current-tree runtime results, authenticated browser/real-PTY acceptance and actual human review were not exercised by this review. Historical tester failures are not asserted to remain after coordinator repairs. Type/test coverage percentages unavailable; no invented metrics. Plan/task status intentionally unchanged under this review assignment's no-tracking constraint.
