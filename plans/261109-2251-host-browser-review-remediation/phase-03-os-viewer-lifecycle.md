# Phase 03 — OS and viewer lifecycle

## Context links
[Overview](plan.md) · [Phase 02](phase-02-stream-input-contracts.md) · [OSQ report](../reports/evc-code-reviewer-261109-2251-os-selection-qualification.md) · [SI report](../reports/evc-code-reviewer-261109-2251-stream-input.md) · [Runtime R1/R2](../reports/review-261109-2251-host-browser-runtime.md) · [Portal precedent](../../packages/ui/src/os/MonacoKeepAliveHost.tsx).

## Overview
Date: 2026-11-09 · Priority: P1 shell/owner/interaction, then P2 decoder/IME · Status: pending · Effort: not estimated. Entire Phase 02 prerequisite; same single integration owner.

## Key Insights
- OSQ:O1 shell-close crash and OSQ:O7 missing local proxy focus reproduced in actual source UI. Other mapped races/state failures are source-reviewed, not claimed live device outcomes.
- Finding map: `repair-browser-portals` ← OSQ:O1; `reconcile-browser-ownership` ← OSQ:O2,O3,O4,O6,L2; `fence-client-input-decoding` ← SI:SI-03,SI-09,SI-10,SI-11; `wire-browser-interaction` ← OSQ:O5,O7,O8 plus Phase 01 LA:L2 popup projection integration. OSQ:L1 server/client logout truth remains Phase 01, not OSQ:L2 reset-owner state.
- Memory portal guidance is corroborated by current MonacoKeepAliveHost imperatively created host + createPortal and current Browser's React-owned div reparenting; follow repository precedent, not another host framework.

## Requirements
- Fix P1 close crash first within this phase after prerequisites: imperative movable host, stable portal-owned React subtree, deterministic root disposal. Placement/unmount detaches presentation only; explicit captured close finalizes target exactly once, preserving sibling PTY/Monaco resources.
- One existing host reconciliation operation captures owner/token/generation, session/process/profile identity, demand and operation currency. Initialize privacy/visibility before attachment; recheck after every await. Demand loss pauses/detaches fresh pair, privacy/owner loss synchronously blackens and invalidates decode/input.
- Re-list/get exact persisted logical session before tickets; adopt server identity, never incarnation "1"/epoch0 fallback. Missing/restarted target offers explicit URL restore with reloaded warning, not duplicate auto-create or unsaved DOM promise. Persist URL/non-secret logical reference only; recipes remain URL/config only.
- Capture creationKey before dispatch and retain ambiguous create/close finalizer beyond window disappearance; reconcile same key, close late committed target, expose pending/failed close retry rather than log-and-forget. No cleanup retargeting to replacement owner.
- Logout fences/blackens captured view before disconnect invalidates generation; owner loss also retires sockets/pixels synchronously. Reset pending context keyed by auth owner plus operation; every status/reset mutation rechecks captured token/generation/request/dialog, including same-profile replacement login.
- Input cleanup owns original socket/target/lease and contiguous sequence. Flush pending movement barrier before key/button release, finish old channel before rebind, and close/revoke on saturation instead of dropping cleanup. No release through replacement lease.
- Fresh target/owner attach synchronously retires cached pixels/header/hit rectangle; every control/media/decode callback checks captured immutable socket/owner identity. Authoritative profile/geometry/run fence advances on receipt; old active decode cannot paint or restore hit testing after newer epoch; every bitmap/disposition retires on all draw/error/discard/dispose paths.
- Commit text once per actual composition/edit transaction; consume trailing native composition commit, never time/text dedup that drops legitimate repeats. Preserve plain-text paste and suppress composing key duplicates.
- Lease state/deadline tied to exact viewer; renew every5s within30s TTL, release/clear on pause, expiry, socket loss, suppression and rejected renewal; fence late acquire/renew callbacks. Authorized gesture/explicit keyboard control focuses actual proxy; shell/modal/privacy blur and block it.
- Deliver native alert/confirm/prompt opened/closed events through bounded production control with exact target/dialog/holder; use existing shared Radix focus trap and explicit response/error states, dismiss on loss. Project admitted native popup to separate OS window, overflow notice, no duplicate window/target allocation. Ancillary chooser/permissions/download/upload remain visibly denied.

## Architecture
Root OsResourceHost → imperative stable Browser host → createPortal(CanvasView + TextInputProxy + shared dialog). Existing owner-reactive connection snapshot drives one session/demand operation; it owns attachment pair and lease, not separate connect/restore effects. Socket/decode/input callbacks carry captured immutable credentials. Native lifecycle/control events update exact current window/session only; no new parallel ownership store.

## Related code files
Modify existing task paths below; MonacoKeepAliveHost is read-only precedent. BrowserStreamKeepAliveHost, BrowserApp, window-store and browser-host controllers remain owners. Remove obsolete split restore effects, identity defaults and ambient cleanup once migrated. No unrelated source removal/new framework; preserve extension/BrowserDebug definitions and HtmlPreview behavior without inventing a new SPA mount. Phase 04 owns doc/changelog reconciliation.

## Implementation Steps
### repair-browser-portals
1. Imperatively create/register movable container in layout lifecycle; portal stable subtree into it using Monaco pattern. Root cleanup disposes controllers/portal/host in safe ownership order; preserve same canvas/controller across placement and remove without React removeChild conflict.
### reconcile-browser-ownership
2. Unify create/adopt/attach/resume/close under existing host's captured-owner/demand operation; initialize suppression first, recheck currency at each boundary, retain creation/closure identity until final native result. Resolve persisted exact session before minting fresh tickets.
3. Move local logout fence before disconnect and synchronously retire on owner loss; qualify Settings reset pending/status state by captured auth owner+operation and fence every mutation, including old same-profile results.
### fence-client-input-decoding
4. Bind held/coalesced/release state to original channel with ordered flush barriers; close/revoke on saturation. Retire cached presentation synchronously on identity change; fence late status/decode by owner/socket/profile/epoch/run, including old decode completing after new epoch arrival.
5. Replace IME text/time heuristic with explicit composition/edit transaction state and exactly-once trailing-event consumption. Keep real repeats/paste distinct and dispose all bitmap/error/discard paths with exact originating-socket credit.
### wire-browser-interaction
6. Bind lease acquisition/renew/release and badge to current pair; focus proxy only from authorized gestures/keyboard control and enforce shell-modal/privacy arbitration. Wire actual native dialogs through bounded control events/shared modal and Phase 01 popup projection; no auto-accept or silent denial.

## Todo list
```evcrate-tasks
[
  {
    "id": "repair-browser-portals", "title": "Repair live Browser close with portal-safe DOM ownership", "blocked_by": ["bound-browser-payloads"],
    "allowed_files": ["packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/OsResourceHost.tsx", "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx", "packages/ui/browser-tests/os-lifecycle.browser.tsx"],
    "constraints": ["First bounded Phase 03 repair after prerequisites; reuse Monaco imperative-host/createPortal pattern, no React-owned child reparenting or component unmount target DELETE."],
    "acceptance": ["OSQ:O1 addressed: closing actual connected Browser never throws/enters shell ErrorBoundary; canvas/controller/remote target survive placements; explicit close disposes local host exactly once and unrelated shell resources remain live."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-lifecycle.browser.tsx browser-tests/os-lifecycle.browser.tsx; exact-source/production-backend chooser→stream→Control→Close journey with pageerror/console failure oracle and native session absence; Phase 04 integrated replay required."]
  },
  {
    "id": "reconcile-browser-ownership", "title": "Unify owner, demand, reconnect and close reconciliation", "blocked_by": ["repair-browser-portals"],
    "allowed_files": ["packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/window-store.ts", "packages/ui/src/os/persistence.ts", "packages/ui/src/os/persistence.test.ts", "packages/ui/src/api/browser-host-client.ts", "packages/ui/src/api/browser-host-client.test.ts", "packages/ui/src/components/organisms/ServerProfilesDialog.tsx", "packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx", "packages/ui/src/components/organisms/ServerSettingsDialog.tsx", "packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx", "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx", "packages/ui/browser-tests/host-browser-logout.browser.tsx", "packages/ui/browser-tests/os-input-isolation.browser.tsx"],
    "constraints": ["One existing host reconciliation owner, exact captured auth/operation checks, no fallback identity or automatic duplicate create; preserve URL-only recipe export and V1 Cancel-first logout."],
    "acceptance": ["OSQ:O2,O3,O4,O6,L2 addressed: reload adopts exact live target or explicit restore; initially/late hidden-private attach cannot gain demand; logout blackens before disconnect; lost create/failed delete retains finalizer/retry; stale reset results cannot alter replacement-owner pending state."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/os/persistence.test.ts src/api/browser-host-client.test.ts src/components/organisms/ServerProfilesDialog.test.tsx src/components/organisms/ServerSettingsDialog.test.tsx; browser lifecycle/logout/input-isolation suites; delayed ticket/create/status responses across privacy, PIN, minimize, close, failed DELETE, reconnect and same-profile relogin; assert real canvas/socket/native identity, not CSS/token-only state."]
  },
  {
    "id": "fence-client-input-decoding", "title": "Fence client input, presentation and IME edit transactions", "blocked_by": ["reconcile-browser-ownership"],
    "allowed_files": ["packages/ui/src/browser-host/input-controller.ts", "packages/ui/src/browser-host/input-controller.test.ts", "packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts", "packages/ui/src/browser-host/text-input-proxy.tsx", "packages/ui/src/browser-host/canvas-view.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/browser-tests/host-browser-decoder.browser.tsx", "packages/ui/browser-tests/host-browser-input.browser.tsx", "packages/ui/browser-tests/host-browser-android.browser.tsx"],
    "constraints": ["Release only original channel before replacement binding; exact old socket credit, one active decode plus one pending, no time-based same-text suppression or stale-pixel cache reuse."],
    "acceptance": ["SI:SI-03,SI-09,SI-10,SI-11 addressed: pending movement cannot cause release gap, saturation closes/revokes reliably, old owner pixels/status/hit rectangle never survive reattach, old-epoch decode never draws after new geometry, complete native composition sequences commit once while repeated genuine identical edits both commit."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/browser-host; pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-decoder.browser.tsx browser-tests/host-browser-input.browser.tsx browser-tests/host-browser-android.browser.tsx; delayed old-decode/new-epoch and old-socket callback barriers, saturated channel with held chord/queued move, compositionend plus trailing beforeinput/input and repeated edits; verify remote DOM and every bitmap/disposition cleanup."]
  },
  {
    "id": "wire-browser-interaction", "title": "Complete lease, text focus, native dialog and popup interaction", "blocked_by": ["fence-client-input-decoding"],
    "allowed_files": ["packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/window-store.ts", "packages/ui/src/browser-host/canvas-view.tsx", "packages/ui/src/browser-host/text-input-proxy.tsx", "packages/ui/src/api/browser-host-types.ts", "packages/ui/src/api/browser-host-client.ts", "server/src/browser_host/cdp.rs", "server/src/browser_host/media.rs", "server/src/browser_host/input.rs", "server/src/browser_host/session.rs", "server/src/api/browser_host.rs", "server/tests/browser_host_input.rs", "server/tests/browser_host_media.rs", "packages/ui/browser-tests/host-browser-input.browser.tsx", "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx", "packages/ui/browser-tests/os-input-isolation.browser.tsx"],
    "constraints": ["Lease bound to exact paired viewer, bounded native control events and existing shared Radix modal; focus only authorized proxy gesture; popup observes admitted target, never creates replacement."],
    "acceptance": ["OSQ:O5,O7,O8 addressed and LA:L2 OS projection completed: Controlling survives valid renewals beyond 30s and clears on revocation/pause; canvas/keyboard activation focuses real proxy, suppression blurs; native alert/confirm/prompt round-trip explicitly and loss dismisses; admitted popup yields one window and overflow notice."],
    "verification": ["Future: real OS control held beyond 30s, pause/restore/revoke/renew failure and late acquire; gesture→actual textarea focus→remote typing/paste; page-triggered alert/confirm/prompt accept/cancel/loss; native popup/default-cap overflow and separate OS window identity; pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-input.browser.tsx browser-tests/host-browser-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx; physical keyboard/IME proof remains Phase 04, not emulation."]
  }
]
```
- [ ] <!-- evcrate-task:repair-browser-portals --> Repair portal deletion ownership
- [ ] <!-- evcrate-task:reconcile-browser-ownership --> Reconcile owner/demand/session lifetime
- [ ] <!-- evcrate-task:fence-client-input-decoding --> Fence input/decode/edit transactions
- [ ] <!-- evcrate-task:wire-browser-interaction --> Complete native interaction UI

## Success Criteria
All eight OS findings, OSQ:L2 and four client SI findings mapped above close with consumer-visible regressions; no shell crash, owner leakage, hidden attachment, stuck control or duplicate IME transaction. Preserve PTY/Monaco identity, same-target multiple viewers, cooperative bridge/HtmlPreview and recipe redaction. Native device acceptance not inferred from synthetic events.

## Risk Assessment
Portal remount can silently lose canvas or pending native cleanup; preserve stable host identity, root-owned finalizer and captured owner. Async reconciliation can attach after privacy or close; operation cancellation plus post-await identity/demand checks required. Rollback disable/drain Browser; do not restore unsafe iframe/reparent fallback.

## Security Considerations
Local synchronous blackening is mandatory even offline/failed server revoke. Modal/privacy/shell arbitration releases native state before new owner interaction; retained pixels, callbacks and pending reset state are owner-qualified data. No tickets/leases/incarnation as persisted authority, no auto-accepted native dialog/host permission.

## Next steps
Phase 04 repairs application fixtures/oracles and executes one coherent integration pass after all shared edits land. No launch approval from component tests or this authoring result; hardware/soak/human prerequisites remain blocking.
