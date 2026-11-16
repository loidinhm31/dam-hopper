# Phase 02 — UI DevTools Dock, Toolbar Controls & Download Banner

Priority: P2 · Status: DONE (2026-11-16 05:01:24 EST) · Effort: 5h · Owner: Frontend implementer

## Context Links

- [Plan Overview](./plan.md)
- [Phase 01 — Backend DevTools Proxy & Native Host Downloads](./phase-01-backend-devtools-proxy.md)
- [BrowserApp (`packages/ui/src/os/apps/BrowserApp.tsx`)](../../packages/ui/src/os/apps/BrowserApp.tsx)
- [BrowserAddressBar (`packages/ui/src/os/browser/browser-address-bar.tsx`)](../../packages/ui/src/os/browser/browser-address-bar.tsx)
- [BrowserTools (`packages/ui/src/os/browser/browser-tools.tsx`)](../../packages/ui/src/os/browser/browser-tools.tsx)
- [Browser Host Client (`packages/ui/src/api/browser-host-client.ts`)](../../packages/ui/src/api/browser-host-client.ts)

## Overview

1. Add a **Developer Tools** toggle button to `BrowserAddressBar` and `BrowserTools`, and mount a docked `BrowserDevToolsDock` component inside `BrowserApp` rendering the host machine's native `devtools_app.html` inside an owner-fenced, privacy-guarded `<iframe>`.
2. Display a live **Host Download Status** banner in `BrowserApp` when `activeTab.snapshot?.lastDownload` reports an in-progress, completed, or canceled native download on the host machine.

## Key Insights

1. **No Control Lease Required to Inspect:** Viewing Console errors, Network requests, or DOM elements in DevTools uses the target-scoped DevTools WebSocket (`/api/browser/devtools/{token}/ws`) and does not require holding the cooperative canvas control lease (`leaseToken`).
2. **Synchronous Privacy & Visibility Teardown:** Whenever `privacyMasked` (`isCognitoActive || isLocked`), `ownerMismatch`, `!isVisible`, or tab/session rotation occurs, `BrowserDevToolsDock` immediately unmounts the `<iframe>` and revokes the server lease, and the download banner is masked/hidden in privacy mode.
3. **Native Host Download Visibility:** Since headless Chromium (`Page.startScreencast`) only streams the web page viewport and not Chrome's native download shelf, rendering a compact banner in `BrowserApp` from `activeTab.snapshot?.lastDownload` gives the user immediate feedback (`Downloading <name>…` -> `Saved <name> on host: <filePath>`) with a dismiss button.

## Requirements

### Functional

1. **API Client & Types (`browser-host-types.ts`, `browser-host-client.ts`):**
   - Add `BrowserDownloadSummary` to `BrowserSessionDto`:
     ```ts
     export interface BrowserDownloadSummary {
       guid: string;
       suggestedFilename: string;
       state: "inProgress" | "completed" | "canceled";
       receivedBytes: number;
       totalBytes: number;
       filePath?: string;
     }
     ```
     and optional `lastDownload?: BrowserDownloadSummary | null` on `BrowserSessionDto`.
   - Add `DevToolsLeaseResponse` interface (`token`, `expiresAtUnixMs`, `browserSessionId`, `browserIncarnation`, `profileEpoch`).
   - Add `createBrowserDevToolsLease(owner, sessionId, signal?)`, `revokeBrowserDevToolsLease(owner, sessionId, token, signal?)`, and `buildBrowserDevToolsUrl(owner, token, panel = "console")`.
2. **Toolbar & Browser Tools Controls (`browser-address-bar.tsx`, `browser-tools.tsx`):**
   - In `BrowserAddressBar`, add a Developer Tools toggle button (`data-testid="browser-devtools-toggle-btn"`, `aria-label="Developer tools"`, `aria-pressed={devToolsOpen}`) enabled when `tab.phase === "live" && Boolean(tab.sessionId) && !masked`.
   - In `BrowserTools`, add `"Open DevTools"` / `"Close DevTools"` (`data-testid="browser-tools-devtools-btn"`).
3. **Docked DevTools Component (`packages/ui/src/os/browser/browser-devtools-dock.tsx`, <200 LOC):**
   - Mints a fresh DevTools lease via `createBrowserDevToolsLease(owner, sessionId)` on mount / target change, verifying `isCurrentConnection(owner)` and matching `browserIncarnation` and `profileEpoch`.
   - Renders a compact header bar with title `"Developer Tools"`, dock side toggle (`data-testid="browser-devtools-dock-side-btn"`, Bottom vs. Right), reload button (`data-testid="browser-devtools-reload-btn"`), and close button (`data-testid="browser-devtools-close-btn"`).
   - Renders `<iframe data-testid="browser-devtools-iframe" title="Chromium Developer Tools" src={devToolsUrl} className="w-full flex-1 min-h-0 border-0 bg-[#292a2d]" />` when ready, or loading/error state with retry.
   - Calls `revokeBrowserDevToolsLease` on unmount or target rotation.
4. **Native Host Download Banner & Layout Integration in `BrowserApp.tsx`:**
   - Render `<BrowserDevToolsDock />` inside the active tab panel when `devToolsOpen && isVisible && !masked && activeTab.phase === "live" && Boolean(activeTab.sessionId)` (using `flex-col` for Bottom dock and `flex-row` for Right dock while keeping `slotRef` mounted in place).
   - When `!masked && activeTab.snapshot?.lastDownload` is present and not dismissed for its `(guid, state)` pair, render a compact banner (`data-testid="browser-download-banner"`) showing:
     - `inProgress`: `Downloading {suggestedFilename} ({receivedBytes} B)…`
     - `completed`: `Downloaded {suggestedFilename} to host ({filePath ?? "Downloads"})`
     - `canceled`: `Download canceled ({suggestedFilename})`
     with a dismiss button (`data-testid="browser-download-dismiss-btn"`).

### Non-Functional

- Keep `packages/ui/src/os/browser/browser-devtools-dock.tsx` under 200 lines of code.
- Preserve `slotRef` DOM node identity across DevTools open/close and dock-side switches (F2 invariant).

## Architecture

```mermaid
flowchart TD
    Toolbar["BrowserAddressBar / BrowserTools<br/>(browser-devtools-toggle-btn)"] -->|Toggle devToolsOpenByTab[tabId]| App["BrowserApp.tsx"]
    App -->|isVisible && !masked && phase==='live'| Dock["BrowserDevToolsDock.tsx"]
    App -->|activeTab.snapshot.lastDownload| DlBanner["Host Download Status Banner<br/>(browser-download-banner)"]
    Dock -->|createBrowserDevToolsLease| Client["browser-host-client.ts"]
    Dock -->|Mount <iframe src=devtools_app.html?ws=...>| Iframe["Native Chromium DevTools UI"]
    Dock -->|Unmount / Cognito / Lock / Tab Switch| Revoke["revokeBrowserDevToolsLease"]
```

## Related Code Files

- **Create:** `packages/ui/src/os/browser/browser-devtools-dock.tsx`
- **Create:** `packages/ui/src/os/browser/browser-devtools-dock.test.tsx`
- **Modify:** `packages/ui/src/api/browser-host-types.ts`
- **Modify:** `packages/ui/src/api/browser-host-client.ts`
- **Modify:** `packages/ui/src/api/browser-host-client.test.ts`
- **Modify:** `packages/ui/src/os/browser/browser-address-bar.tsx`
- **Modify:** `packages/ui/src/os/browser/browser-tools.tsx`
- **Modify:** `packages/ui/src/os/browser/browser-tools.test.tsx`
- **Modify:** `packages/ui/src/os/apps/BrowserApp.tsx`
- **Modify:** `packages/ui/src/os/apps/BrowserApp.test.tsx`

## Implementation Steps

1. Update `packages/ui/src/api/browser-host-types.ts` (`BrowserDownloadSummary`, `lastDownload` on `BrowserSessionDto`, `DevToolsLeaseResponse`) and `packages/ui/src/api/browser-host-client.ts` (`createBrowserDevToolsLease`, `revokeBrowserDevToolsLease`, `buildBrowserDevToolsUrl`).
2. Create `packages/ui/src/os/browser/browser-devtools-dock.tsx` (<200 LOC).
3. Add the Developer Tools toggle button to `BrowserAddressBar` (`browser-devtools-toggle-btn`) and `BrowserTools` (`browser-tools-devtools-btn`).
4. Wire `BrowserDevToolsDock` and the `browser-download-banner` in `BrowserApp.tsx`.
5. Add unit and component tests in `browser-host-client.test.ts`, `browser-devtools-dock.test.tsx`, `browser-tools.test.tsx`, and `BrowserApp.test.tsx`.

## Todo List

```evcrate-tasks
[
  {
    "id": "ui-devtools-dock",
    "title": "Add DevTools dock, toolbar controls, and native host download status banner in BrowserApp",
    "blocked_by": ["backend-devtools-proxy"],
    "allowed_files": [
      "packages/ui/src/api/browser-host-types.ts",
      "packages/ui/src/api/browser-host-client.ts",
      "packages/ui/src/api/browser-host-client.test.ts",
      "packages/ui/src/os/browser/browser-devtools-dock.tsx",
      "packages/ui/src/os/browser/browser-devtools-dock.test.tsx",
      "packages/ui/src/os/browser/browser-address-bar.tsx",
      "packages/ui/src/os/browser/browser-tools.tsx",
      "packages/ui/src/os/browser/browser-tools.test.tsx",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/os/apps/BrowserApp.test.tsx"
    ],
    "constraints": [
      "Keep browser-devtools-dock.tsx under 200 lines.",
      "Never persist DevTools tokens to localStorage or session state.",
      "Immediately unmount the DevTools iframe, revoke the lease, and hide download file paths when Cognito mode, Lock Screen, owner mismatch, or tab/window hiding occurs."
    ],
    "acceptance": [
      "Clicking browser-devtools-toggle-btn on a live tab mints a DevTools lease and mounts browser-devtools-iframe pointing to devtools_app.html with panel=console.",
      "Users can switch the DevTools dock between Bottom and Right split, reload DevTools, or close it while the streamed canvas remains mounted in slotRef.",
      "When activeTab.snapshot.lastDownload is present, browser-download-banner displays in-progress or completed host download status and can be dismissed.",
      "Activating Cognito Privacy Mode, locking the screen, switching tabs, or closing the tab unmounts the DevTools iframe and revokes the server lease."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/os/browser/browser-devtools-dock.test.tsx src/os/browser/browser-tools.test.tsx src/os/apps/BrowserApp.test.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  }
]
```

- [x] <!-- evcrate-task:ui-devtools-dock --> Add DevTools dock, toolbar controls, and native host download status banner in BrowserApp

## Success Criteria

- `browser-devtools-toggle-btn` and `browser-tools-devtools-btn` toggle the docked native Chromium DevTools iframe for the active live tab.
- `browser-download-banner` surfaces live host download progress and completion (`filePath`) and respects privacy mode masking.

## Risk Assessment

- **Stale async lease response after tab switch:** Guarded by `attemptId`, `mountedRef`, `isCurrentConnection(owner)`, and matching session identity before state update, immediately revoking stale tokens.

## Security Considerations

- Capability token stays exclusively in volatile React state; host download paths are hidden whenever `privacyMasked` or `ownerMismatch` is active.

## Next Steps

- Proceed to [Phase 03](./phase-03-verification-and-docs.md) for integrated verification and documentation updates.
