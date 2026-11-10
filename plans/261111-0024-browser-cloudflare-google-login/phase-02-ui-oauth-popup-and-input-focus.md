# Phase 02 — UI OAuth Popup and Input Focus

Priority: P2 · Status: pending · Effort: 6h · Owner: UI implementer; final integration owner owns checks/docs.

## Context and dependencies
- [Overview](./plan.md); [backend contract](./phase-01-backend-stealth-and-popup-state.md).
- Existing source: `browser-session-sync.ts` guards current connection/window/session/incarnation, preserves monotonic navigation/viewport revisions and clears controller credentials on retirement. Extend it; do not introduce a competing session store.
- `BrowserApp.tsx` owns toolbar acquisition; `BrowserStreamKeepAliveHost.tsx` owns actual `TextInputProxy` and stream/input lifecycle. Preserve that boundary.
- Backend optional wire fields: `activePopupSessionId?: string`, `parentSessionId?: string`, `popupBlocked?: boolean`. Parent active pointer means an admitted **Running** child, not authorization to reuse the parent's lease.

## Requirements and state transitions
- Normalize snapshot fields into window `appState`: `activePopupSessionId`, `parentSessionId`, `popupBlocked` (missing boolean becomes false; absent relationship fields clear previous values).
- On a live opener's newly observed active popup, record `openerSessionId` and its owner/runtime identity, then switch the existing window to the child after verifying its same-owner Running snapshot. Surface a popup banner and **Return to Page** action.
- Manual return restores opener viewing without closing the popup or resubmitting login. A visible **Open sign-in popup** action permits switching back while the active popup remains running.
- Remember the already-auto-opened popup per window/opener runtime, so Return to Page is not immediately undone by the next parent snapshot. New child IDs can auto-open; repeated snapshots cannot.
- Child `status: "closed" | "lost"`, including a close before viewer attachment completes, restores its still-live opener automatically. A missing/lost opener yields explicit unavailable state, not a new session or ambient fallback.
- Switching sessions clears viewer/lease/controller/dialog/input state for the old attachment. Acquire child control through existing policy; never copy parent tokens. Keep underlying opener native page/profile/cookies alive.
- Blocked popup shows an accessible alert with actionable capacity/admission guidance; do not claim that login succeeded or offer security-policy bypass.

### Transition table
| Current view / event | Required result |
| --- | --- |
| Opener Running; new child Running | Record qualified opener; auto-switch once; display popup banner |
| Popup; Return to Page | Fetch/reconcile opener; switch back; mark this child already auto-opened |
| Opener; same active child update | Stay on opener; offer Open sign-in popup |
| Opener; newer active child | Validate and auto-switch to the new child |
| Popup; child closed/lost | Restore live opener; clear obsolete popup-local attachment state |
| Popup; opener already lost | Show unavailable state; no browser recreation or unrelated target selection |
| Any; stale owner/incarnation/action | Discard result; never mutate successor attachment |
| Any; `popupBlocked` true | Show alert; absent/false later clears it |

Parent links may form a short existing popup chain. Resolve Return to Page using the current child's immediate `parentSessionId`; do not overwrite a recorded original opener with the child itself. Use server parent linkage/snapshots when rebuilding context after reconnect; no new persistent stack or nested-popup feature service. Ordinary session selection clears unrelated popup return context.

## File ownership and actions
All paths relative to `/home/loidinh/WS/dam-hopper/`.

| Task | Action / files |
| --- | --- |
| `sync-oauth-popup-view` | Modify `packages/ui/src/api/browser-host-types.ts`, `packages/ui/src/os/browser-session-sync.ts`, `browser-session-sync.test.ts`, `apps/BrowserApp.tsx`, `apps/BrowserApp.test.tsx`, `BrowserStreamKeepAliveHost.tsx`, `BrowserStreamKeepAliveHost.test.tsx` |
| `focus-login-input` | Modify `packages/ui/src/os/apps/BrowserApp.tsx`, `apps/BrowserApp.test.tsx`, `BrowserStreamKeepAliveHost.tsx`, `BrowserStreamKeepAliveHost.test.tsx` after popup task; reuse existing proxy API |
| `qualify-browser-login` | No product writes; final integration owner runs commands and manual journeys |
| `document-browser-login` | Modify existing `docs/architecture/host-browser-cdp-streaming.md`, `docs/code-standards.md`, `docs/CHANGELOG.md` after qualification |

No new dependencies, persistent fields or files required. Input proxy/controller remain unchanged unless implementation demonstrates an existing-API limitation; escalate additional writable files rather than broadening ownership silently.

## Implementation steps

### sync-oauth-popup-view
1. Extend `BrowserSessionDto` with the three optional camelCase properties. Keep existing status/string epoch representation and update affected test fixtures intentionally; do not make optional backend metadata required.
2. Extend `syncBrowserSessionWindow` to normalize/clear popup metadata while retaining all owner, session, runtime and monotonic revision checks. Relationship changes must not depend on URL revision advancing. Do not let an opener update overwrite a child snapshot currently displayed in the window.
3. Implement one window-local popup selection/return flow shared by automatic switching and toolbar actions. Capture `{profileId, generation, sessionId, browserIncarnation, profileEpoch}` before child/opener lookup; recheck after each await and before one atomic `updateAppState`. Verify child `parentSessionId` matches expected opener and child runtime belongs to the same profile browser. Reuse typed `getBrowserSession` and current transport.
4. Record `openerSessionId` plus qualified return context in ephemeral appState. Before changing `sessionId`, cancel/reset held input, pending gestures, composition and dialogs through existing attachment cleanup, clear stale controller/lease/viewer credentials, and rebind with fresh session snapshot geometry/revisions. Never carry opener lease tokens into popup state.
5. Add banner/actions in `BrowserApp`: Popup / Return to Page when viewing a child; Open sign-in popup on a manually restored opener with live child. Mark the child auto-opened per window/runtime; duplicate/refetched snapshots remain idempotent. Clear stale marker when runtime/opener context retires. Do not infer success from popup closure.
6. In keep-alive event/connect paths, process terminal child snapshots before generic lost/closed handling discards the session. If child closes during lookup/attach, reconcile once through existing session snapshot handling and restore qualified live opener. Late failure/event from the old child must not clear the restored opener. Reuse existing root host; session switches may reattach streams but layout transitions alone must not remount them.
7. On manual return, refresh opener snapshot so callback navigation/title and cleared active pointer are current even though its viewer was detached. Retain server session/native producer, not obsolete viewer credentials. Handle profile switch/reset/disconnect with existing unavailable behavior.
8. Surface `popupBlocked` as `role="alert"` with concise explanation and safe next action (e.g. close an unused browser session and retry the site's button); reflect backend false/omission. Preserve privacy/lock masking and avoid echoing sensitive OAuth URLs or auth errors into notices/logs.
9. Add behavioral tests to existing sync/app/host suites: new/missing fields, metadata-only updates, auto-switch once, Return to Page without bounce, explicit reopen, callback URL refresh, close/lost before and after attachment, closed opener, blocked popup, two children/late old-child close, multi-window isolation and reconnect/stale owner/incarnation responses.

### focus-login-input
1. Reuse the existing toolbar acquisition request and real `TextInputProxyHandle.focus()` owned by keep-alive. After acquisition success, verify owner/generation/session/viewer and active runtime still match before publishing lease/controller state or requesting focus. Failed or superseded acquisition must never focus a successor view.
2. Pass a narrowly scoped, one-shot focus request through the existing window/slot coordination, consumed by keep-alive after the matching lease is usable. If a nonce is needed, keep it ephemeral and bound to owner/session; renewal and unrelated rerenders must not retrigger focus. Do not add a global focus registry or reach into React DOM by selector.
3. Focus proxy only for the visible, active, controllable and unsuppressed window. Recheck `document.activeElement`: retain local input/textarea/select/contenteditable focus and active dialogs; do not steal the address bar or composition focus. A toolbar button itself is not an editable field, so successful button acquisition focuses the proxy without an extra canvas click.
4. Preserve pointer-based acquisition, IME/virtual keyboard handling, Cognito/PIN suppression, visibility and lease revocation cleanup. Remote page focus comes from backend focus emulation; local proxy focus only routes trusted user typing.
5. Test successful toolbar acquisition followed by typing without canvas click, failed/stale acquisition, input/select focus preservation, privacy/hidden window suppression, session change while awaiting lease, and no refocus on lease renewal. Assert proxy/input-controller behavior, not only a focus-call counter.

### qualify-browser-login
Run these commands **once after both phases**, sequentially from repository root; preserve each command's output/exit status:
```sh
cargo test --manifest-path server/Cargo.toml
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui build
```
Automated acceptance: affected and existing suites pass; TypeScript builds; no skipped failure recast as success. Do not run repo-wide lint/build or repeat suites without a failure-driven reason.

Manual journey matrix, actual managed Chromium and DamHopper UI, test account only:
| Journey | Observe / expected |
| --- | --- |
| Cloudflare interstitial | Page visible, controls usable, completion continues navigation when provider permits |
| Turnstile cross-origin iframe | UA/CH/focus/preload inspected on OOPIF; human can interact; first-load/reload outcome recorded |
| Direct `accounts.google.com` | Acquire control via toolbar; type into auto-focused email/password without canvas click; normal challenge/MFA remains manual |
| Google OAuth popup success | Popup appears; enter credentials; callback reaches original opener; popup closes; live opener restored |
| OAuth cancel / manual return | Close/cancel restores opener; Return to Page leaves popup available and does not auto-bounce |
| Blocked / stale / multiple viewers | Clear alert, no unsafe fallback or lease transfer; unrelated window/profile unchanged |
| Window lifecycle | Float/tile/minimize/restore preserves established host continuity, input gating and original opener session |

Record browser version, platform, exact behavior and failures; no passwords, cookies, authorization codes or tokens in artifacts. Separate application regressions from provider refusal/network restrictions. Test-account/MFA availability is a prerequisite to live sign-in evidence, not grounds to fake completion.

### document-browser-login
After implementation/checks, update existing browser architecture for identity setup/order, OOPIF-vs-page attach distinction, optional popup metadata and viewer lease return flow. Update code standards' launch allowlist to document the exact AutomationControlled exception without relaxing other prohibitions. Add a concise changelog entry with honest compatibility/qualification limits. Do not rewrite unrelated architecture or mark third-party support universally verified.

## Durable tasks and todo
```evcrate-tasks
[
  {
    "id": "sync-oauth-popup-view",
    "title": "Surface OAuth popup metadata, switch viewer and restore opener safely",
    "blocked_by": ["publish-popup-lifecycle"],
    "allowed_files": ["packages/ui/src/api/browser-host-types.ts", "packages/ui/src/os/browser-session-sync.ts", "packages/ui/src/os/browser-session-sync.test.ts", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/apps/BrowserApp.test.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx"],
    "constraints": ["Reuse session sync/root keep-alive and owner/runtime fencing; no new persistent state.", "Manual return cannot immediately auto-switch back; session switches never reuse another session's viewer or lease tokens."],
    "acceptance": ["Optional metadata normalizes into appState; running admitted popup auto-opens once with Return to Page and explicit reopening.", "Popup closed/lost restores only its qualified live opener, including close-before-attach; late child events cannot clobber restored state.", "Blocked popup alert, multiple-popup races, stale owner and multi-window isolation have behavioral regression coverage."],
    "verification": ["Final integration owner runs pnpm --filter @dam-hopper/ui test and pnpm --filter @dam-hopper/ui build once after implementation.", "Exercise real OAuth success/cancel/Return to Page/blocked popup; inspect original opener continuity and isolated viewer credentials."]
  },
  {
    "id": "focus-login-input",
    "title": "Focus matching TextInputProxy after successful toolbar control acquisition",
    "blocked_by": ["sync-oauth-popup-view"],
    "allowed_files": ["packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/apps/BrowserApp.test.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx"],
    "constraints": ["Reuse existing proxy handle and narrow window/slot handoff; no focus registry or DOM selector workaround.", "Preserve local editable focus, IME, privacy, visibility, ownership and lease fences; no focus on renewal."],
    "acceptance": ["Toolbar acquisition permits immediate typing into remotely auto-focused login fields without a canvas click.", "Failed/stale acquisition, hidden/privacy-blocked viewers and local input/select focus never receive stolen proxy focus."],
    "verification": ["Final integration owner runs pnpm --filter @dam-hopper/ui test and pnpm --filter @dam-hopper/ui build; inspect acquisition/focus behavioral tests.", "On direct accounts.google.com and popup sign-in, acquire control then type immediately; repeat with address/select focus and privacy suppression."]
  },
  {
    "id": "qualify-browser-login",
    "title": "Collect integrated automated and live browser login evidence",
    "blocked_by": ["focus-login-input"],
    "allowed_files": [],
    "constraints": ["Run integrated commands once sequentially, not while files are being edited.", "Record actual exercised outcomes; credentials, cookies and OAuth tokens must not enter reports."],
    "acceptance": ["Required cargo/UI tests and UI build pass with exact recorded outcomes.", "Manual matrix distinguishes observed Cloudflare/Google outcomes from unqualified/provider-refused behavior and verifies popup/lease continuity."],
    "verification": ["cargo test --manifest-path server/Cargo.toml", "pnpm --filter @dam-hopper/ui test", "pnpm --filter @dam-hopper/ui build", "Perform the manual matrix above on actual managed Chromium using a test account; record version/platform, failures and untested surfaces."]
  },
  {
    "id": "document-browser-login",
    "title": "Document browser identity, popup lifecycle and compatibility limits",
    "blocked_by": ["qualify-browser-login"],
    "allowed_files": ["docs/architecture/host-browser-cdp-streaming.md", "docs/code-standards.md", "docs/CHANGELOG.md"],
    "constraints": ["Only document implemented behavior and exercised results; preserve unrelated docs and existing security invariants.", "No universal challenge-bypass or Google login guarantee."],
    "acceptance": ["Existing browser architecture documents setup ordering and popup viewer/lease lifecycle.", "Launch standards name the exact safe flag exception; changelog describes compatibility fix with honest qualification limits."],
    "verification": ["Review changed documentation against implemented DTOs, CDP ordering, exact launch allowlist and recorded automated/live outcomes; inspect links manually."]
  }
]
```

- [x] <!-- evcrate-task:sync-oauth-popup-view --> Sync, present and restore popup viewers.
- [x] <!-- evcrate-task:focus-login-input --> Focus proxy after toolbar acquisition without stealing local focus.
- [x] <!-- evcrate-task:qualify-browser-login --> Run integrated checks and live journey matrix.
- [x] <!-- evcrate-task:document-browser-login --> Update existing architecture, standards and changelog.

## Failure handling, security and rollback
- UI selection is presentation only, never authorization. Treat server parent/child metadata as owner-bound; do not follow arbitrary session IDs across profiles or generations.
- Closing a viewer must not close the opener native target. Existing server cleanup, auth, storage and network policy remain unchanged.
- Keep popup return/auto-open/focus-request state ephemeral under current persistence allowlist. Never add OAuth URLs/credentials to new persistence or logs.
- On switch/connect/restore failure, retain explicit unavailable/actionable state and stale-result fences; do not create replacement sessions to mask failure.
- Roll back UI fields/switch/focus behavior with backend relationship/identity cutover; keep existing user sessions/profile data. Optional wire fields require no database migration or compatibility shim.

## Handoff and unresolved questions
Authoring complete only after both linked phase contracts are inspected. Implementation, automated/live checks, independent review and final validation are not performed by this authoring assignment; coordinator owns them. No unresolved design questions.
