# Phase 03 — Hub terminal mounts + claim-based attach gate

## Context Links
- Evidence A "Terminal renderer mounting (CRUX)", B1, C (identity, continuity, gate): `./reports/scout-261106-0334-evidence-and-decisions.md`
- P01 frozen interfaces (attach gate, placeholder, mounts store, resolver, claim key, revealWindow): `./phase-01-shared-contracts.md`
- Standards: `docs/code-standards.md:50,169-170` (keep-alive reparenting; single-visible-slot registry)

## Overview
- Priority: P1 · Status: completed · Effort: 9h
- Give Hub-listed sessions real renderers in the singleton `TerminalKeepAliveHost` with stable mount keys, and gate every Hub pane attach path on exclusive claims with the exact TerminalsApp claim identity.

## Parallelization Info
- Group A · Depends on: P01 · Blocks: P06 · Concurrent peers: P02, P04, P05 (disjoint files).

## Key Insights
- Singleton host sessions derive ONLY from `appId==="terminals"` windows (`packages/ui/src/os/OsResourceHost.tsx:202-238`), merged with `mountedSessions` (`:240-253`); OsShell passes none (`packages/ui/src/os/OsShell.tsx:1601`). React key = `mountKey ?? terminalKey` (`packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:75-80`) → key change = TerminalPanel remount.
- Derived memo depends only on `sessionWindows`; no reaction to connection/inventory changes.
- `PaneContainer` resolves by raw string in 9 places (`packages/ui/src/components/organisms/PaneContainer.tsx:104,115,126,143,179,201,272,282,307`) and reparents via `attachTerminalsToHost` (`:107-112`), which already accepts `resolveTerminal` (`packages/ui/src/lib/terminal-host-attachment.ts:13,28,36`). Registry callback matches by raw id (`:125-134`).
- `SplitLayout` is the only path from MultiTerminalDisplay to PaneContainer (`packages/ui/src/components/organisms/SplitLayout.tsx:69-93,240,324`) → must pass the gate through (ownership amendment).
- `MultiTerminalDisplay` prunes layout to `mountedSessions` ids (`MultiTerminalDisplay.tsx:132-133`) → denied/unresolved sessions must stay in `mountedSessions` so persisted v3 layouts are not pruned.
- `ResourceRegistry.claim/release` notify synchronously (`packages/ui/src/os/resource-registry.ts:27-51,86-90`); `useResourceClaim` is single-key (`:125-161`).
- Only the active desktop's non-minimized windows mount (`OsShell.tsx:1661-1666`, `DesktopCanvas.tsx:87-88`): claims follow visibility; Hub unmounts on desktop switch/minimize. Therefore published Hub mounts must outlive Hub component unmount (else every desktop switch remounts all xterms) and be invalidated reactively by root-level state.
- OsShell adopts inventory-verified targets into restored terminals windows (`OsShell.tsx:103-152`) → untargeted standalone windows are transient (pre-launch-confirmation / pre-observation); their claim key (untargeted branch) never equals the Hub's target key.
- F2 (review): `syncTerminalInputSuppression` mutates shared xterm stdin/textarea state directly (`packages/ui/src/lib/terminal-input-policy.ts:22-41`); `attachTerminalsToHost` never clears suppression (`terminal-host-attachment.ts:35-62`); TerminalPanel has its own replay/global calculation (`TerminalPanel.tsx:294-311`, replay drain `:931-943`). A former presenter's late cleanup can therefore disable a successor, and a panel recalculation can clear a pane-only reason → all presentation input goes through the P01 `terminal-presentation-input` contract.
- `TerminalEntry.attachmentElement` is the moved boundary, not its original parent (`packages/ui/src/lib/terminal-registry.ts:12-20`; `TerminalPanel.tsx:388-403,452-459`) → the attachment helper must capture the origin parent itself on first reparent.

## Requirements
- R1 Merge: OsResourceHost consumes `useHubTerminalMountsStore` mounts for hub ids that still exist in `session.windows`, converts each to `MountedSession {mountKey, sessionId: target.terminalId, terminalRef:{profileId,id}, terminalTarget, attachPolicy:"existing-only", project, command, cwd, worktreePath, profileId}` (same shape as derived standalone sessions).
- R2 Reactive validity: drop retained Hub mounts whose owner snapshot is not connected or generation ≠ `target.generation` (subscribe via `subscribeConnections`), and — when that profile's inventory is loaded — whose full `terminalTargetKey` is absent from current `useAggregatedTerminalSessions()` targets (covers exit, replacement, disappearance while Hub unmounted). Prune store entries for closed Hub windows (`clear`).
- R3 One renderer per PTY: renderer identity = `terminalTargetKey` when targeted, else `profileId::terminalId`. A Hub descriptor whose `(profileId, terminalId)` matches an untargeted standalone descriptor is folded into that standalone renderer (no second TerminalPanel/transport).
- R4 Stable mount key: per renderer identity, keep the key of any contributing descriptor already rendered; else retained identity→key map; else first descriptor's key. Transition untargeted→targeted standalone keeps its key (`${w.id}:${profileId}:${sessionId}`). Opening/closing a standalone window for a Hub-shown target, desktop switching, Hub project switch/sidebar hide and Hub close (while another source lists it) never change the key.
- R5 Attach gate (`useHubTerminalAttachGate(options | null)`; null ⇒ returns undefined and holds no claims): desired claims = all `sessionIds` passed (selected group incl. hidden tabs); claim key = `buildTerminalClaimKey({target})` of the CURRENT resolved target (read through a ref at call time; stale callbacks never use an old target). Reconcile in a layout effect (so the first paint after a project switch can already attach): diff by `formatClaimKey`; claim added keys; release removed keys only if held by this hub window; subscription re-claims a desired key only when unclaimed; ignore self-caused notifications (re-entrancy guard); cleanup unsubscribes BEFORE releasing; StrictMode double-mount leaves no orphan/duplicate claims; ordinary re-renders with equal key sets cause zero claim/release.
- R6 States: claim not yet attempted → `pending` (no attach, `renderPlaceholder` returns null — no denial flash); target unresolved → placeholder `unresolved` (no Go-to); claim held by another window → `claimed-elsewhere` with holder; untargeted standalone presenting same `(profileId, terminalId)` → `legacy-presenter` with that window id (compatibility exception, transient until OsShell adopts target). Denied/unresolved/pending NEVER fall back to raw-id lookup.
- R7 PaneContainer with gate: all 9 lookups use `attachGate.resolveTerminal`; registry callback reparents when `node.sessionIds.some(id => attachGate.resolveTerminal(id) === getTerminal(registeredKey))`; attach, keyboard-handler install/cleanup, input suppression, focus and resize effects include `attachGate.revision` in deps; pane renders `renderPlaceholder(activeSessionId)` overlay when non-null.
- R7a Presentation input + claim loss (gate present): after a successful claim + attach the pane calls `acquireTerminalPresentation(term, "hub:<hubWindowId>:<paneId>")` and applies its pane-level reasons via `setPresenterInputSuppression` (e.g. `suppressTerminalFocus`). On claim loss / revocation / unresolve / pane unmount it runs ALL cleanup — custom key-handler reset, suppression, blur, parking — inside `runIfCurrentPresenter(term, token, …)` and then `releaseTerminalPresentation`; once a successor acquired, the old pane's cleanup is a no-op. Parking uses new `parkTerminalElement(entry, fromHost)` in `packages/ui/src/lib/terminal-host-attachment.ts`: `attachTerminalsToHost` records the element's ORIGIN parent (keep-alive slot) on first reparent in a module WeakMap; parking moves it back only if its parent is still `fromHost`. Successors attach via their own claim subscription. Gate absent ⇒ no acquisition, legacy behavior unchanged.
- R7b TerminalPanel (`TerminalPanel.tsx:294-311`): `syncEffectiveStdinSuppression` keeps its panel-level computation (authority revoked, replay/attach gate, `suppressInputRef`, native keyboard) and applies `computePresentedInputSuppression(term, panelValue)`; it subscribes via `subscribeTerminalPresentation` and re-syncs on presenter change (quiet-PTY recovery). Replay drain (`:931-943`) therefore cannot unsuppress a managed terminal without a presenter. Unmanaged terminals: byte-identical behavior.
- R8 MultiTerminalDisplay keeps `renderTerminals` caller-controlled (Hub passes false via Display); gate absent ⇒ legacy behavior identical.
- R9 Placeholder: "Terminal open in another window" + "Go to window" → `useWindowStore.getState().revealWindow(holderWindowId)` (P01); never closes windows or kills sessions (B1).

## Architecture
```
AgentHubApp(P06) --publish(hubId, HubTerminalMount[])--> hub-terminal-mounts-store(P01)
OsResourceHost --mergeTerminalMountDescriptors(hub, derived, prevKeys, validity)--> TerminalKeepAliveHost (singleton)
Display(P06) -> MultiTerminalDisplay(attachGate) -> SplitLayout(attachGate) -> PaneContainer(attachGate.resolveTerminal / renderPlaceholder)
useHubTerminalAttachGate(hubWindowId, sessionIds, resolveTarget) <-> globalResourceRegistry (multi-key reconcile)
```
- New pure module `packages/ui/src/os/agent-hub/merge-hub-terminal-mounts.ts`: `mergeTerminalMountDescriptors({ hubMounts, derived, renderedKeys, retainedKeys, isValidHubTarget }) → { sessions: MountedSession[]; retainedKeys: Map<string,string> }`.

## Related Code Files
- Modify: `packages/ui/src/os/OsResourceHost.tsx`, `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`, `packages/ui/src/components/organisms/MultiTerminalDisplay.test.tsx`, `packages/ui/src/components/organisms/SplitLayout.tsx`, `packages/ui/src/components/organisms/PaneContainer.tsx`, `packages/ui/src/components/organisms/PaneContainer.test.tsx`, `packages/ui/src/lib/terminal-host-attachment.ts`, `packages/ui/src/lib/terminal-host-attachment.test.ts` (origin capture + `parkTerminalElement`), `packages/ui/src/components/organisms/TerminalPanel.tsx`, `packages/ui/src/components/organisms/TerminalPanel.test.tsx` (R7b)
- Create: `packages/ui/src/os/agent-hub/merge-hub-terminal-mounts.ts`, `packages/ui/src/os/agent-hub/merge-hub-terminal-mounts.test.ts`, `packages/ui/src/os/agent-hub/use-hub-terminal-attach-gate.ts`, `packages/ui/src/os/agent-hub/use-hub-terminal-attach-gate.test.ts`, `packages/ui/src/os/agent-hub/HubTerminalClaimPlaceholder.tsx`, `packages/ui/src/os/agent-hub/HubTerminalClaimPlaceholder.test.tsx`, `packages/ui/browser-tests/os-hub-terminal-mounts.browser.tsx`
- Delete: none

## Ownership & Conflict Prevention
- Exclusive in Group A. Amendments: `SplitLayout.tsx`, `PaneContainer.test.tsx`, `lib/terminal-host-attachment.ts(+test)`, `TerminalPanel.tsx(+test)` (F2), `merge-hub-terminal-mounts.ts(+test)`, `HubTerminalClaimPlaceholder.test.tsx` added to P03. No edits to `TerminalKeepAliveHost.tsx`, `lib/terminal-input-policy.ts` (P01), `OsShell.tsx`, `TerminalsApp.tsx` (P04), store/resolver files (P01). `p03-hub-mounts-browser` waits on `p04-adopt-lifecycle` (task ordering only, no shared file) so the handoff test exercises an adopted TerminalsApp.

## Implementation Steps
1. `p03-mount-merge`: write pure merge (R1, R3, R4) with unit tests: hub-only, standalone-only, same target both (one descriptor, first-rendered key kept across order flips), hub closed while standalone lists target (key unchanged), standalone untargeted→targeted transition (key unchanged, hub folded), legacy untargeted + hub same PTY (one descriptor), invalid hub target dropped. Wire in OsResourceHost with `useRef` key maps, `useSyncExternalStore(subscribeConnections, …)` signature, `useAggregatedTerminalSessions()` targets, and an effect pruning `clear(hubId)` for closed Hub windows (R2).
2. `p03-pane-attach-gate`: add `TerminalAttachGate` type (export from `MultiTerminalDisplay.tsx`), thread through SplitLayout to PaneContainer (R7, R7a, R8); add origin capture + `parkTerminalElement` with tests (parks only when parent is `fromHost`; origin recorded on first reparent). Unit tests: gate absent → existing PaneContainer/MultiTerminalDisplay tests pass unchanged and no presentation acquired; gate denying → no `attachTerminalsToHost` element moves and placeholder rendered; late registration resolves via callback; revision bump re-runs keyboard handler install; revocation runs guarded cleanup (handler removed, suppressed, parked); successor acquired before old cleanup → old cleanup no-op (handler, stdin, focus, parent untouched); denied sessions stay in layout (no prune).
2b. `p03-panel-presentation-input`: implement R7b in `TerminalPanel.tsx`; extend `TerminalPanel.test.tsx`: unmanaged terminal suppression unchanged; replay completion with no presenter keeps managed terminal suppressed; acquisition on a quiet PTY (no output) re-enables stdin; presenter reason + replay gate compose (either suppresses).
3. `p03-hub-attach-gate-hook`: implement R5/R6 and placeholder (R9). Tests (jsdom, `ResourceRegistry` real instance): claim all desired incl. hidden tabs; first claim wins vs another window; takeover after holder release; release only own; StrictMode mount/unmount/mount leaves exactly one claim; equal re-render no churn; same-id replacement releases old incarnation claim and claims new; stale `resolveTerminal` after replacement returns undefined for old target; legacy-presenter detection from window store; placeholder Go-to calls `revealWindow`.
4. `p03-hub-mounts-browser`: browser test with OsResourceHost + a minimal Hub-like harness publishing mounts + a standalone Terminals window (P04-adopted): xterm `Terminal` instance identity survives (a) opening then closing a standalone window for the same target, (b) desktop switch away/back, (c) Hub harness project switch; exactly one `TerminalPanel` per target (DOM count) and one transport attach (spy on attach/replay entry); Hub→standalone handoff with old Hub cleanup running before AND after standalone acquisition → standalone typed input reaches the PTY on a quiet session; hidden-tab and disconnected-owner stdin suppression; claim lost with NO successor → element parked, keystrokes reach no PTY, replay completion does not re-enable stdin; denied pane shows placeholder and Go-to reveals holder across desktops.

```evcrate-tasks
[
  {
    "id": "p03-mount-merge",
    "title": "Merge Hub mounts into the singleton terminal host with stable mount keys",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/os/agent-hub/merge-hub-terminal-mounts.ts", "packages/ui/src/os/agent-hub/merge-hub-terminal-mounts.test.ts", "packages/ui/src/os/OsResourceHost.tsx"],
    "constraints": ["Exactly one TerminalKeepAliveHost (no nested host); OsShell.tsx untouched.", "Hub mounts are never persisted; validity reacts to connection and inventory changes, not only window-store changes (R2)."],
    "acceptance": ["One descriptor per PTY across Hub and standalone sources; renderer mount key unchanged across Hub/standalone ownership transitions, untargeted-to-targeted adoption and Hub close (Invariant C continuity).", "Retained Hub mounts with retired generation, disconnected owner, closed Hub window, or absent/replaced inventory target are dropped (Invariant C1)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/merge-hub-terminal-mounts.test.ts", "pnpm --filter @dam-hopper/ui build"]
  },
  {
    "id": "p03-pane-attach-gate",
    "title": "Thread optional attach gate through MultiTerminalDisplay, SplitLayout and PaneContainer",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/components/organisms/MultiTerminalDisplay.tsx", "packages/ui/src/components/organisms/MultiTerminalDisplay.test.tsx", "packages/ui/src/components/organisms/SplitLayout.tsx", "packages/ui/src/components/organisms/PaneContainer.tsx", "packages/ui/src/components/organisms/PaneContainer.test.tsx", "packages/ui/src/lib/terminal-host-attachment.ts", "packages/ui/src/lib/terminal-host-attachment.test.ts"],
    "constraints": ["Gate absent must be behavior-identical (existing tests unchanged and green, no presentation acquired).", "With gate present, no raw-id getTerminal fallback in any of the 9 PaneContainer lookups; all cleanup (key handler, suppression, blur, parking) runs only via P01 runIfCurrentPresenter; parking never moves an element whose parent is no longer this pane's host."],
    "acceptance": ["All attach paths (initial, registry callback, hidden tabs, focus/keyboard/resize effects, unmount) consult the gate; denied or unresolved sessions never attach and render the placeholder (Invariant C gate).", "On claim loss, revocation, unresolve or unmount the current presenter pane removes its key handler, suppresses stdin and parks only elements it still hosts; if a successor already acquired, the old pane's cleanup changes nothing (F2).", "Denied/unresolved sessions remain in mountedSessions so persisted terminal-layout:v3 layouts are not pruned (AC3)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/PaneContainer.test.tsx src/components/organisms/MultiTerminalDisplay.test.tsx src/lib/terminal-host-attachment.test.ts"]
  },
  {
    "id": "p03-panel-presentation-input",
    "title": "Compose TerminalPanel replay/global suppression with presentation ownership",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/components/organisms/TerminalPanel.tsx", "packages/ui/src/components/organisms/TerminalPanel.test.tsx"],
    "constraints": ["Only syncEffectiveStdinSuppression and a presentation subscription change; panel-level reasons (authority revoked, replay gate, suppressInput, native keyboard) keep current semantics.", "Never-acquired terminals behave byte-identically."],
    "acceptance": ["Replay completion cannot unsuppress a managed terminal with no presenter; presenter acquisition re-enables stdin on a quiet PTY; panel and presenter reasons compose (F2)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/TerminalPanel.test.tsx", "pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-replay-integrity.browser.ts browser-tests/terminal-panel-replay-notifications.browser.tsx"]
  },
  {
    "id": "p03-hub-attach-gate-hook",
    "title": "Multi-key Hub claim reconciliation hook and Go-to-window placeholder",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-reveal-window", "p03-pane-attach-gate"],
    "allowed_files": ["packages/ui/src/os/agent-hub/use-hub-terminal-attach-gate.ts", "packages/ui/src/os/agent-hub/use-hub-terminal-attach-gate.test.ts", "packages/ui/src/os/agent-hub/HubTerminalClaimPlaceholder.tsx", "packages/ui/src/os/agent-hub/HubTerminalClaimPlaceholder.test.tsx"],
    "constraints": ["Claim keys only via P01 buildTerminalClaimKey({target}); first claim wins; never close windows or kill sessions (B1).", "Reconcile is re-entrancy safe, unsubscribes before release, and releases only this hub window's claims."],
    "acceptance": ["Claims cover every session in the selected group including hidden tabs; another window's claim yields a placeholder whose Go to window switches desktop, restores and focuses the holder (B1).", "StrictMode remount, equal re-render, holder release takeover and same-id replacement leave exactly the expected claims with no churn or stale-target attach (Invariant C)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/use-hub-terminal-attach-gate.test.ts src/os/agent-hub/HubTerminalClaimPlaceholder.test.tsx"]
  },
  {
    "id": "p03-hub-mounts-browser",
    "title": "Browser regression for Hub renderer continuity, exclusivity and input isolation",
    "blocked_by": ["p03-mount-merge", "p03-hub-attach-gate-hook", "p03-panel-presentation-input", "p04-adopt-lifecycle"],
    "allowed_files": ["packages/ui/browser-tests/os-hub-terminal-mounts.browser.tsx"],
    "constraints": ["Real Chromium; use a minimal harness publishing to the P01 store (AgentHubApp integration is P06).", "Do not edit other browser tests."],
    "acceptance": ["xterm instance identity survives standalone open/close, desktop switch and harness project switch; exactly one TerminalPanel and one transport attach per target (Invariant C continuity).", "Hub-to-standalone handoff with old Hub cleanup before and after standalone acquisition leaves the standalone terminal interactive on a quiet PTY (F2).", "Hidden-tab, disconnected-owner and claim-lost-without-successor input never reaches a PTY, including after replay completion; denied pane shows placeholder and Go to window reveals the holder (B1)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-hub-terminal-mounts.browser.tsx"]
  }
]
```

- [x] <!-- evcrate-task:p03-mount-merge --> Merge Hub mounts into the singleton terminal host with stable mount keys
- [x] <!-- evcrate-task:p03-pane-attach-gate --> Thread optional attach gate through MultiTerminalDisplay, SplitLayout and PaneContainer
- [x] <!-- evcrate-task:p03-panel-presentation-input --> Compose TerminalPanel replay/global suppression with presentation ownership
- [x] <!-- evcrate-task:p03-hub-attach-gate-hook --> Multi-key Hub claim reconciliation hook and Go-to-window placeholder
- [x] <!-- evcrate-task:p03-hub-mounts-browser --> Browser regression for Hub renderer continuity, exclusivity and input isolation

## Success Criteria
- B1 + invariants C (identity separation, renderer continuity, all-path gate, own-claim release) + F2 presentation-input handoff proven by unit + browser tests. Enables AC3/AC5/AC6 terminal continuity in P06.
- **H2 Remediation Verified:** `PaneContainer.tsx:225` enforces presentation-input policy across all tab transitions (`const suppress = shouldSuppressTerminalFocus || !isActiveSession; syncTerminalInputSuppression(resolveTerminal(sessionId)?.terminal ?? null, suppress);`), ensuring non-active/quiet terminals remain strictly suppressed without being overridden by pane-local sync loops.

## Risk Assessment
- Renderer count: Hub publishes all live canonical sessions → one TerminalPanel/transport each. Decided (V2): NO cap; P07 R5 measures (no thresholds) deduped renderer instances, active listener registrations minus releases, cumulative attach/replay attempts and JS heap with ≥20 sessions across ≥2 profiles (F10); a residual registration after Hub close reopens this phase.
- Claim churn/focus theft from registry notifications → re-entrancy guard + revision-based effects; StrictMode tests.
- TerminalPanel is a hot path (`TerminalPanel.tsx` 1707 lines); R7b change is limited to the suppression sync + one subscription; replay browser suites run unchanged.
- Legacy-presenter exception may briefly show placeholder after reload until OsShell adopts the target (`OsShell.tsx:103-152`).

## Security Considerations
- Exact full-target claims and resolution prevent cross-incarnation/epoch attachment; no raw-id fallback; disconnected owners suppress stdin.

## Rollback
- Gate prop optional; reverting P03 restores legacy PaneContainer/OsResourceHost. Hub store unused without P06.

## Next Steps
- P06 publishes mounts, builds gate per selected group, passes `attachGate` via Display.

## Unresolved questions
- None (V2 decided: no renderer cap; measured in P07).
