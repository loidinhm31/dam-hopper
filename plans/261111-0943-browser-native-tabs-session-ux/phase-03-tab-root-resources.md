# Phase 03 — Tab-scoped root resources

Priority P2 · Pending · 10h (3h sync/popups, 7h host). Owner: BrowserIntegrator; both tasks sequential. Depends on phase 02 lifecycle and projections. [Design](design.md) sections 2, 4–5; A01/A03/A07–A09/A11/A14.

## Existing source and changes
- Modify `packages/ui/src/os/browser-session-sync.ts` + existing test: replace flat state application with `(owner,windowId,tabId,sessionId,snapshot,expectedRuntime)` contract. Remove `switchBrowserWindowSession`; no re-export/shim. Tests must target actual nested tabs.
- Create `packages/ui/src/os/browser/browser-popup-tabs.ts` + test (<200 LOC each): admitted-child dedupe, parent verification, tab insertion/removal and guarded local focus decisions; reuse pure tab updates and lifecycle closure.
- Modify existing `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` + test narrowly. Current key/slot references occur throughout host; all must become tuple-aware, including sync subscriptions, input lookups, audio-block state, focus listeners, request callbacks, dialog authority, text proxy and late cleanup. No unrelated stream-controller rewrite.

## tab-fence-snapshots-popups
1. Locate exact tab from current window store on every sync. Check verified scope/current generation, expected session/runtime, snapshot identity and action/subscription retirement. Keep independent nav/viewport monotonic comparisons and terminal status invalidation. Preserve geometry object reuse where unchanged. Remove newly affected `Number(profileEpoch)` coercions; retain decimal-string authority and lower-layer explicit safe conversion boundaries.
2. Commit URL/title/status only to intended tab; dirty draft untouched. Same-target snapshot fanout stays independently profile-owner/generation verified, never reuses another profile's snapshot/credentials or matches by URL. Snapshot arrival cannot reset durable suppression or bypass first-hydration/write-time recovery exclusion; runtime address may remain usable while disk projection omits it.
3. Popup service verifies parentSessionId, incarnation/profileEpoch and current parent link; append after opener with stable ID and sticky provenance. Admission/new-reference insertion takes the lifecycle native-key gate across same-client profiles, not `(profileId,sessionId)` alone; a pending/unknown final close blocks admission. Every GET remains initiating owner-authorized. Repeated snapshots cannot duplicate/repeatedly activate.
4. Admission auto-selection only when original opener still selected in same focused window; completion return only when popup still active there. No `focusWindow`/DOM focus from a background response. If active child in background window is removed, choose fallback inside that window without revealing/focusing it. Missing opener => nearest ordinary or blank.
5. Do not keep hidden popup sockets just for completion. Reconcile via GET on tab activation and one single-flight child GET on changed popup link in a visible opener snapshot; no recurring poll. Both hidden can remain visually stale until activation. A dismissed/closed popup ID cannot be rediscovered on repeated stale snapshots.

## tab-key-root-viewers
1. Enumerate all canonical tabs, not one win.id resource. Root React key is encoded window+tab tuple. Stable host element/controller/proxy/PCM refs survive body slot remount and placement reparenting. Blank/deferred tabs do not dispatch target creation just because enumerated.
2. Change `BrowserStreamSlot` and registry/register/update/unregister/audio/focus APIs to require window+tab identity. Viewer-local `ResourceClaimKey.resourceId` uses same tuple; distinct same-client views may share native target within unchanged limits. Before new session reference/viewer attachment, consult lifecycle's native-key closing gate across profiles and validate captured owner/runtime; no ticket/socket request while final delete pending/unknown, never borrowed credentials.
3. Remove create work from visibility effect. Hook exact explicit intent into root lifecycle service independent of stream attachment; creation can finish/cleanup after view close. Bootstrap/reconnect only GETs known IDs. Missing/lost/closed transitions unavailable and clears input/leases/attachments; no URL-only implicit POST.
4. Effective visibility adds active tab and verified owner equality to current placement/privacy/lock/fence checks. Direct synchronous subscriptions must flush PCM, release input/lease, retire selection/handoff and close media/control on tab change **before React commit**. Old ticket/socket completions cannot reattach hidden/replaced tab. Close outgoing sockets before minting incoming tab tickets; transient viewer budget error is explicit retry, never new native target.
5. Current visible placement transitions preserve controller/canvas and existing connection; hiding permits fresh tickets on return but no native recreation/navigation. Browser windows visible simultaneously can each stream their selected tab; do not equate OS focus with visibility.
6. Route selection/dialog/audio snapshot/event callbacks through exact tab and subscription. On tab hide reset pending gesture/IME proxy and stale dialog/selection UI; when reactivated fetch actual dialog/control state rather than replaying stale requests. Keep server page alive. Preserve Cognito/reset/lock invalidation and lower-layer audio document epochs.
7. Unit tests use genuine new schema/verified connections, not legacy runtime fixtures. Assert API/socket/controller counts and object refs. Cover same URL/different targets, same target across two profile IDs including hidden view, popup/viewer admission racing final close, owner/runtime change denying tickets, decimal revisions above safe range and snapshots not clearing suppression.

## Risks, failure and rollback
Big existing host is coupling risk: no blanket replacement; update key plumbing/callback captures together. Server viewer permit release may lag socket close: expose typed viewer-capacity error with retry, preserve native target. Popup focus changes must remain local/conditional. Root teardown on explicit settled close removes only that resource; placement never triggers DELETE. Rollback follows design; keeping window-only aliases would hide migration errors and is prohibited.

## Success and next dependency
Host and sync no longer read/write Browser flat aliases or swap opener session in-place; inactive zero-attachment/audio invariant intact. Phase 04 starts after `tab-key-root-viewers`; no verification executed during authoring.

```evcrate-tasks
[
  {
    "id": "tab-fence-snapshots-popups",
    "title": "Scope snapshots and popup lifecycle to exact tabs",
    "blocked_by": [
      "own-browser-target-lifecycle"
    ],
    "allowed_files": [
      "packages/ui/src/os/browser-session-sync.ts",
      "packages/ui/src/os/browser-session-sync.test.ts",
      "packages/ui/src/os/browser/browser-popup-tabs.ts",
      "packages/ui/src/os/browser/browser-popup-tabs.test.ts"
    ],
    "constraints": [
      "Clean removal of window-session switching API; migrate callers in following task/phase, no compatibility exports.",
      "Canonical decimal strings and bigint comparison at affected sites; no background polling/viewer. Profile-qualified snapshot authority stays separate from cross-profile native-key close/admission gate; snapshots never clear durable address suppression."
    ],
    "acceptance": [
      "Snapshot sync addresses exact owner/window/tab/session/runtime; stale nav/viewport or owner cannot overwrite newer state/dirty draft.",
      "Popup inserted adjacent once from verified parent/current-runtime snapshot; native-key gate spans profile IDs and blocks closing-target admission; lifetime popup provenance excluded from disk.",
      "Admission/completion only changes focus if expected opener/popup still selected in same focused window; no late focus steal.",
      "Hidden popup completion reconciled on activation or changed visible opener link, without hidden sockets."
    ],
    "verification": [
      "Extend sync/popup cases for duplicate/late lookup, owner/runtime mismatch, cross-profile closing gate, suppression retention, opener gone and completion after selection/window change; run phase 05."
    ]
  },
  {
    "id": "tab-key-root-viewers",
    "title": "Retain stable root resources and active-only streaming per tab",
    "blocked_by": [
      "tab-fence-snapshots-popups"
    ],
    "allowed_files": [
      "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx",
      "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx"
    ],
    "constraints": [
      "Existing large host modified surgically; keep lower-layer stream/audio/input implementation and all privacy/reset fences.",
      "No native create from attachment; explicit root lifecycle owns create. Slot/audio/focus take tuple without aliases; session/viewer admission checks shared native-key closing gate, with each profile retaining its own captured request authority."
    ],
    "acceptance": [
      "Stable root item/container/canvas/controller/proxy per window+tab across placement and tab changes.",
      "Only active visible unfenced verified tab attaches paired media/control; hidden tabs have zero streaming viewers and flushed PCM/held input/control lease.",
      "Switch return uses GET/live ID and fresh tickets as needed, never native create/reload; old subscription callbacks cannot mutate new tab.",
      "Popup swap removed; opener/popup distinct resources; target/viewer capacity distinct. Pending/unknown native close blocks racing new reference/ticket attachment across profile IDs; hidden shared view remains counted and live."
    ],
    "verification": [
      "Add host identity/socket-order/late-callback/privacy/shared-view tests including two profile IDs sharing exact native key and final-close attach exclusion; no-auto-create/suppression-reset assertions; integrated run phase 05."
    ]
  }
]
```

- [ ] <!-- evcrate-task:tab-fence-snapshots-popups --> Scope snapshots and popup lifecycle to exact tabs
- [ ] <!-- evcrate-task:tab-key-root-viewers --> Retain stable root resources and active-only streaming per tab
