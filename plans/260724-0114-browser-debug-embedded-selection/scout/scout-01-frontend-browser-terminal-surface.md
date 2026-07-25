# Frontend scout: embedded browser + terminal handoff surface

## Current composition and registration

- `packages/ui/src/components/pages/WorkspacePage.tsx` is the frontend composition root. It owns `workspaceMode`, compact surface selection, the terminal manager result, and all reusable panel content.
  - Desktop IDE: `leftTools` contains Search/Explorer/Commit and bottom Terminal/Git/Ports; `rightTools` contains Project/Fleet. Rendered through `IdeShell`.
  - Desktop terminal: `TerminalWorkspaceShell` receives explicit `terminalContent`, `fleetContent`, `gitContent`, `portsContent`; its terminal header also hard-codes Git/Ports/Fleet launcher buttons.
  - Compact IDE: `IDE_COMPACT_SURFACE_IDS` plus `compactIdeSurfaces`.
  - Compact terminal: `TERMINAL_COMPACT_SURFACE_IDS` plus `compactTerminalSurfaces`.
  - Browser therefore needs registration in all three branches: one IDE `ToolWindowDef`, a new terminal-shell content/launcher, and both compact arrays/ID allowlists. Build one shared `browserContent` value in this file and pass the current `activeTab`.
- `packages/ui/src/components/templates/IdeShell.tsx` is already generic over `ToolWindowDef[]`. Tool selection is persisted by side/position in `localStorage` (`dam-hopper:ide-left-top`, `...left-bottom`, `...right-top`, `...right-bottom`). No structural shell change is required unless Browser gets an imperative activation request/shortcut.
- `packages/ui/src/types/ide.ts` defines the reusable `{ id, label, icon, content, position?, defaultActive? }` contract.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx` is not generic. It resolves only Git/Ports/Fleet and renders the selected item via `TerminalFloatingToolPanel`. Add a `browserContent` prop and Browser label/content branch.
- `packages/ui/src/lib/terminal-workspace-panel.ts` constrains `TerminalWorkspacePanelId` to `"git" | "ports" | "terminals"` and has the toggle resolver. Add `"browser"` if Browser is exposed as the terminal-mode floating tool.
- `packages/ui/src/lib/ide-shell-layout.ts` similarly constrains keyboard-exclusive `TerminalPanelToolId` to Git/Ports/Fleet. Extend only if Browser gets the same exclusive shortcut/activation behavior; update its mutual-exclusion rules and tests.
- `packages/ui/src/components/templates/MobileWorkspaceShell.tsx` is generic and keeps every surface in the current array mounted, toggling `hidden`, `inert`, opacity, and pointer events. This preserves an iframe while switching compact tabs within one mode.
- `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` supplies the draggable/resizable terminal-mode container. It currently has minimum 480x360 and default 720x600, suitable for a browser panel without a second frame implementation.

## Iframe, bridge, and capture state

- No iframe/webview, embedded URL state, `postMessage` bridge, `getDisplayMedia`, canvas crop, or screenshot state exists under `packages/ui/src` today.
- Recommended new files:
  - `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`: URL/navigation toolbar, iframe/ref, bridge status, selection UI, capture/upload fallback, active-terminal handoff controls and confirmation.
  - `packages/ui/src/lib/browser-debug-protocol.ts`: discriminated message envelopes, runtime parser/guards, nonce/request correlation, exact `event.origin` and `event.source === iframe.contentWindow` validation.
  - `packages/ui/src/lib/browser-capture.ts`: feature detection, user-activated `getDisplayMedia`, track cleanup, CSS-rect-to-capture-pixel mapping/clamping, canvas/Blob creation, typed denial/unsupported outcomes.
  - Optional `packages/ui/src/hooks/use-browser-debug.ts` if orchestration becomes too large for the component.
- Ownership caveat: switching between desktop `IdeShell` and `TerminalWorkspaceShell` changes the rendered parent type and remounts panel children. A memoized React element alone does not preserve component/iframe runtime state across that switch. Lift URL, handshake metadata, current selection, capture metadata, and errors to `WorkspacePage` or a dedicated store if they must survive mode changes. Preserving the live iframe document/history itself requires a single keep-alive host outside the conditional shells (or accepting reload/re-handshake on mode change).
- The closest keep-alive pattern is `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` plus module-level xterm registry: terminals remain independently owned and the visible terminal displays use `renderTerminals={false}`. Browser can copy the ownership principle, but not reuse the xterm host directly.

## Active terminal and safe handoff

- `packages/ui/src/hooks/use-terminal-manager.ts` owns `activeTab` and exposes it in `state`; open/select paths update it, while close/remove may set it to the last remaining tab or `null`.
- `WorkspacePage.tsx` already destructures `activeTab`, `mountedSessions`, and `sessionMap`. It can pass `activeSessionId={activeTab}` plus alive/project metadata into Browser without a new global terminal store.
- `packages/ui/src/lib/terminal-registry.ts` is an imperative module-level `Map<string, TerminalEntry>` with `registerTerminal`, `getTerminal`, `removeTerminal`, and `subscribeToRegistry`. `WorkspacePage.tsx` already uses `terminalRegistry.has/get` plus `subscribeToRegistry` for deferred notification focus. Use that pattern only when handoff requires a mounted xterm/focus; PTY input itself does not require registry access.
- Actual PTY input goes through `getTransport().terminalWrite(sessionId, data)` (`packages/ui/src/api/transport.ts`, implemented in `packages/ui/src/api/ws-transport.ts`). Existing call sites:
  - `packages/ui/src/components/organisms/TerminalPanel.tsx`: user input, history insertion, suggestion suffix.
  - `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`: explicit key/input actions.
- New browser artifact/reference insertion should be centralized in a small pure helper, likely `packages/ui/src/lib/browser-terminal-handoff.ts`: require non-null/alive active session, explicit user confirmation, reject CR/LF and C0/ANSI/OSC controls, cap length, write no `\r`/Enter, then optionally focus via registry. Do not embed screenshot/HTML bytes in terminal input; insert a bounded artifact reference/envelope.

## Typed transport/client surface

- `packages/ui/src/api/client.ts` contains frontend DTOs and the typed `api` facade. Add browser artifact/request/selection types (or a dedicated `packages/ui/src/api/browser-debug-types.ts`) and `api.browserDebug.*` methods here.
- `packages/ui/src/api/transport.ts` exposes generic JSON/text `invoke`, event subscriptions, and terminal fire-and-forget methods.
- `packages/ui/src/api/ws-transport.ts` maps channel names to REST endpoints in `channelToEndpoint`, adds auth/base URL, JSON-stringifies request bodies, and decodes only JSON/text from `invoke`.
- Consequence: `invoke` is fine for bridge metadata, artifact metadata, lookup/delete, or a JSON DOM snapshot. It is not suitable for efficient PNG/Blob upload because every body is JSON-stringified. Prefer a typed binary upload method on `Transport` (implemented with authenticated `fetch` in `WsTransport`) or a dedicated typed `WsTransport.browserArtifactUpload(...)`, following the existing specialized binary FS methods. Avoid base64 screenshot payloads unless the accepted size is deliberately tiny.
- Add endpoint mapping tests in `packages/ui/src/api/ws-transport.test.ts`; its fetch/WebSocket mocks already verify URL/method/body behavior.

## Tests to extend/create

- Modify `packages/ui/src/components/pages/WorkspacePage.test.tsx`: assert Browser appears in compact IDE and compact terminal surfaces; capture `IdeShell`/`TerminalWorkspaceShell` props and assert desktop registration/content. Update settings/API mocks if new dependencies are read.
- Modify `packages/ui/src/components/templates/TerminalWorkspaceShell.test.ts` and `packages/ui/src/lib/terminal-workspace-panel.ts` tests for Browser open/replace/toggle behavior.
- Modify `packages/ui/src/lib/ide-shell-layout.test.ts` only if Browser joins shortcut exclusivity. `packages/ui/src/components/templates/IdeShell.test.tsx` needs no change for a normal generic tool.
- Create `packages/ui/src/lib/browser-debug-protocol.test.ts`: wrong origin/source/nonce/version/type, stale response, navigation re-handshake, oversized payload.
- Create `packages/ui/src/lib/browser-capture.test.ts`: DPR/zoom scale, bounds clamping, zero-size rect, wrong capture surface, denied/unsupported, and guaranteed track cleanup.
- Create `packages/ui/src/lib/browser-terminal-handoff.test.ts`: no session, stale/dead session, control/newline rejection, length cap, exact one write, and no implicit Enter.
- Create `packages/ui/src/components/organisms/BrowserDebugPanel.test.tsx`: URL/loading/error states, iframe sandbox/permissions, bridge state, capture fallback, and confirmed handoff.
- Create `packages/ui/browser-tests/browser-debug-panel.browser.tsx`: real Chromium iframe/ref + `MessageEvent` source/origin validation, selection overlay behavior, compact hidden/inert persistence, and denied/unsupported screenshot fallback. Headless `getDisplayMedia` cannot exercise the real chooser reliably; stub the media API here and retain a manual browser permission check.
- Browser suite configuration is `packages/ui/vitest.browser.config.ts`; command is `pnpm --filter @dam-hopper/ui test:browser`.

## Likely modify/create summary

Modify:

- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`
- `packages/ui/src/lib/terminal-workspace-panel.ts`
- `packages/ui/src/api/client.ts`
- `packages/ui/src/api/transport.ts`
- `packages/ui/src/api/ws-transport.ts`
- associated tests above
- `packages/ui/src/lib/ide-shell-layout.ts` and `packages/ui/src/stores/settings.ts` only if a Browser shortcut is in scope

Create:

- `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`
- `packages/ui/src/lib/browser-debug-protocol.ts`
- `packages/ui/src/lib/browser-capture.ts`
- `packages/ui/src/lib/browser-terminal-handoff.ts`
- focused unit/component/browser tests listed above

## Unresolved questions

- Where should Browser live in desktop IDE: maximizable bottom tool (best viewport), right sidebar, or center editor-like surface?
- Must the live iframe and its history survive IDE/terminal mode changes, or is preserving URL/selection state and reloading acceptable?
- Is the target always a controlled app with a cooperative bridge, and what exact parent/target origins and iframe `sandbox`/`allow` capabilities are permitted?
- Does Browser need its own keyboard shortcut and mutual exclusion with Git/Ports/Fleet?
- What exact server artifact API and ownership model will the frontend target, and will PNG upload be REST binary, multipart, or a new WS binary protocol?
- What artifact reference syntax should be inserted into the active terminal, and must the recipient agent/tool understand a fetch helper?
- Which Chromium/browser versions and capture APIs are release targets; which parts remain manual because the display picker requires user activation?
