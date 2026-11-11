# Host Browser Native Tabs and Session UX Evidence Report

## 1. Executive Summary & Current Behavior Gaps

| Capability | Current State in Source | Behavior Gap |
| :--- | :--- | :--- |
| **Tab Multiplicity** | 1 OS Window = 1 Session (`BrowserApp.tsx:187`, `BrowserStreamKeepAliveHost.tsx:1490-1540`) | No in-window tabs; opening 5 pages requires 5 tiled/floating OS windows. |
| **Target Chooser** | Full-window modal overlay (`BrowserApp.tsx:44-160`) | Blocks entire viewport; "Cancel" closes the entire OS window (`BrowserApp.tsx:91`). Cannot browse while opening a new target. |
| **Address Bar Draft** | Transient component state (`BrowserApp.tsx:197, 210-212`) | Overwritten on any session/URL update (`previewUrl`); uncommitted drafts are lost on tab/popup switch or reload. |
| **Popup Lifecycle** | In-place session swap (`browser-session-sync.ts:91-138`, `BrowserApp.tsx:710-743`) | Replaces opener viewport in-place; opener is hidden and unviewable during OAuth. Reconnects stream and drops viewer lease. |
| **Keep-Alive Identity** | 1 stream container per `window.id` (`BrowserStreamKeepAliveHost.tsx:57-65, 359-375`) | Slot registry and parking containers are keyed strictly by `windowId`. No sub-tab stream multiplexing or multi-tab keepalive. |
| **Backend Target Cap** | Configured `DEFAULT_MAX_TARGETS = 2`, `DEFAULT_MAX_VIEWERS = 2` (`server/src/browser_host/config.rs:8-12`) | Multiple concurrent tabs quickly trigger `429 Busy` or `popupBlocked: true` unless background tabs sleep or disconnect. |

## 2. Exact Files & Create Candidates

### Modified Files
- `packages/ui/src/os/apps/BrowserApp.tsx`: Refactor toolbar, embed native tab bar, support in-tab chooser, isolate per-tab draft/status.
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`: Extend `slotRegistry` to support tab-level stream multiplexing or per-tab slot reparenting without destroying background sessions.
- `packages/ui/src/os/browser-session-sync.ts`: Expand snapshot sync to accept `tabId` targeting; replace in-place opener swap with tab-spawning.
- `packages/ui/src/os/window-store.ts`: Window close must iterate and terminate all active tab sessions; tab close must terminate individual tab session.
- `packages/ui/src/os/intents.ts` & `packages/ui/src/os/OsShell.tsx`: Add optional `targetMode: "new-tab" | "new-window"` to `browser:open` / `browser:preview`.
- `packages/ui/src/os/action-executor.ts`: Support opening a new tab inside focused browser window rather than always spawning a new OS window.

### Create Candidates (Modularization Boundaries)
- `packages/ui/src/os/browser/browser-tab-types.ts`: Core tab state interface (`BrowserTabState`), unique tab IDs vs session IDs, tab history, audio status.
- `packages/ui/src/os/browser/BrowserTabBar.tsx`: Native tab strip container (`role="tablist"`), New Tab `+` button, overflow management, keyboard navigation.
- `packages/ui/src/os/browser/BrowserTabItem.tsx`: Individual tab molecule (`role="tab"`), title truncation, close `×` button, audio playing/mute badge, favicon/spinner.
- `packages/ui/src/os/browser/BrowserAddressBar.tsx`: Modularized navigation toolbar (Back, Forward, Reload, address input with draft retention, audio toggle, lease status).
- `packages/ui/src/os/browser/BrowserTabChooser.tsx`: In-tab blank/chooser page rendered inside the active tab body, preventing whole-window takeover.

## 3. Recommended Native Tab UX (Responsive & Accessibility Choices)

- **Visual Layout**: Tab bar sits immediately above the address bar. Active tab visually merges with the address bar (`var(--color-surface)`), while inactive tabs rest on `var(--color-surface-2)` with muted text.
- **Responsive Sizing**:
  - Full width ($\ge 800\text{px}$): Tabs expand up to $220\text{px}$, title with favicon and close `×` button.
  - Medium ($500\text{--}799\text{px}$): Tabs compress down to $100\text{px}$, close button hides on unselected tabs unless hovered.
  - Narrow ($< 500\text{px}$): Tabs compress to $44\text{px}$ (favicon only), horizontal scroll with hidden scrollbar or overflow chevron dropdown.
- **Accessibility (ARIA / APG Tabs Pattern)**:
  - Tablist container specifies `role="tablist"` and `aria-label="Browser tabs"`.
  - Each tab specifies `role="tab"`, `aria-selected={isActive}`, `aria-controls={`browser-tabpanel-${tabId}`}`, `id={`browser-tab-${tabId}`}`.
  - Roving `tabIndex`: Active tab has `tabIndex={0}`, inactive tabs have `tabIndex={-1}`.
  - Arrow key navigation: `ArrowRight` / `ArrowLeft` traverses tabs; `Home` / `End` jumps to first / last tab.
  - Close button has explicit `aria-label="Close tab: <Title>"` and `type="button"`.

## 4. Ownership Invariants (IDs & Authority Separation)

- **ID Hierarchy**:
  - `window.id`: Top-level OS desktop window entity (UUID, e.g. `browser-a1b2c3d4`).
  - `tabId`: Client-side tab entity (UUID, e.g. `tab-e5f6g7h8`). **NEVER** identical to or conflated with backend session IDs.
  - `sessionId` (`browserSessionId`): Rust server CDP target session (UUID minted by `SessionRegistry`).
  - `viewerId`: Transient viewer lease token minted by `mintViewerAttachmentTickets`.
- **Invariants**:
  1. A tab can exist with `sessionId === undefined` (e.g. freshly opened blank/chooser tab).
  2. Tab close MUST call `closeBrowserSession(owner, tab.sessionId)` only for its own target session, leaving sibling tabs live.
  3. Window close MUST close all sessions associated with all tabs in that window.
  4. Session authority fields (`browserIncarnation`, `profileEpoch`, `navigationRevision`, `viewportEpoch`) belong strictly to the specific backend target, fenced per tab.

## 5. Popup-as-Tab Implications (OAuth & Lifecycle)

- **Current Deficiency**: When an OAuth popup opens, `switchBrowserWindowSession` (`browser-session-sync.ts:91`) replaces the opener session in the same window slot, blinding the user to the original page and requiring a complete stream reconnect.
- **Recommended Popup UX**:
  1. Admitted popups (`activePopupSessionId`) automatically spawn as a **new adjacent tab** tagged with `isPopup: true` and `parentTabId`.
  2. The opener tab remains live and visible in the tab bar.
  3. When popup authenticates and closes (`closed` or `lost`), the popup tab auto-retires, automatically focusing the opener tab.
  4. Capacity fence: Because backend `DEFAULT_MAX_TARGETS = 2`, having 1 opener tab + 1 popup tab consumes the entire default target budget. If 2 tabs are already open, an OAuth popup triggers `popupBlocked: true`. The UI must warn the user to close a tab or configure larger target budgets.

## 6. Hidden Tab Audio & Video Stream Behavior

- **Video Streaming (CDP Screencast)**:
  - Background tabs MUST call `setVisibility(false)` on their stream controllers (`BrowserStreamKeepAliveHost.tsx:635`).
  - Halts video credit requests, preventing unnecessary CDP JPEG encoding, network traffic, and client decode cycles.
  - Switching back to a tab calls `setVisibility(true)`, immediately resuming credit exchange and rendering.
- **Audio Streaming (PCM WebAudio)**:
  - Policy: By default, background tabs should keep live audio playing (like native browsers for YouTube/podcasts) UNLESS explicitly muted via the tab mute button.
  - Tab Bar Audio Cue: Tabs playing audio render a speaker badge (`data-testid="tab-audio-indicator"`). Clicking the badge toggles viewer-local mute for that specific tab.
  - Global Privacy & Reset Invariant: Cognito Privacy Mode (`Mod+Alt+KeyB`), Lock Screen PIN, or Profile Reset fence MUST synchronously flush and mute ALL audio across active and hidden tabs instantly (`BrowserStreamKeepAliveHost.tsx:418-426, 501-527`).

## 7. Shortcut Collisions with Real Outer Browser

| Shortcut | Outer Browser Action | Web App Capability | DamHopper OS Mitigation |
| :--- | :--- | :--- | :--- |
| `Ctrl+T` / `Cmd+T` | Opens new outer browser tab | Browser hardcoded; cannot intercept in JS | Use `Alt+T` or `Ctrl+Alt+T`, plus prominent visual `+` button in tab bar. |
| `Ctrl+W` / `Cmd+W` | Closes outer browser tab | Hardcoded in Chrome; closes web app | Use `Alt+W` or `Ctrl+Alt+W`, close button on tab, or OS Command Palette. |
| `Ctrl+R` / `F5` | Reloads entire DamHopper OS | Can preventDefault if focused in canvas/proxy | Guarded by `browser-shortcut-guard.ts:11`; toolbar Reload button provided. |
| `Ctrl+L` / `Alt+D` | Focuses outer browser address bar | Outer browser hardcoded in many platforms | Provide `Alt+L` / `Ctrl+Alt+L` to focus inner address bar, or click to edit. |
| `Ctrl+Tab` | Cycles outer browser tabs | Hardcoded by host browser | Use `Ctrl+PageDown` / `Ctrl+PageUp` or `Alt+[` / `Alt+]` for tab cycling. |

## 8. Existing Test Commands & Verification Matrix

- **Unit Tests**:
  - `pnpm --filter @dam-hopper/ui test packages/ui/src/os/apps/BrowserApp.test.tsx` (14 unit tests)
  - `pnpm --filter @dam-hopper/ui test packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx` (39 unit tests)
  - `pnpm --filter @dam-hopper/ui test packages/ui/src/os/browser-session-sync.test.ts` (6 unit tests)
  - `pnpm --filter @dam-hopper/ui test packages/ui/src/browser-host/stream-controller.test.ts` (31 unit tests)
  - `pnpm --filter @dam-hopper/ui test packages/ui/src/browser-host/pcm-player.test.ts` (5 unit tests)
- **Browser Lifecycle Regressions**:
  - `pnpm --filter @dam-hopper/ui test:browser packages/ui/browser-tests/host-browser-lifecycle.browser.tsx` (3 browser tests)
  - `pnpm --filter @dam-hopper/ui test:browser packages/ui/browser-tests/os-lifecycle.browser.tsx` (13 browser tests)
- **Build / Typecheck**:
  - `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`)
- **Backend Rust Tests**:
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_media`

## 9. Status & Unresolved Questions

- **Status**: Investigation Complete. All UI architectures, lifecycle bounds, and keepalive contracts mapped.
- **Unresolved Question 1**: Should background tabs maintain active WebSocket connections for background audio, or should background tabs be completely paused (audio + video) unless explicitly pinned/flagged, to stay within `DEFAULT_MAX_VIEWERS = 2`?
- **Unresolved Question 2**: Should the backend `DEFAULT_MAX_TARGETS` (currently 2) be increased to 4 or 6 in `config.rs`, or should the UI implement client-side tab discarding/sleeping when tabs exceed target capacity?
