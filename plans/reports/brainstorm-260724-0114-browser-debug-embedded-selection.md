# Browser Debug Preview and UI Selection

## Problem

DamHopper users need to inspect a running UI, select the problematic region, and
give useful context to an AI agent running in an xterm terminal. The first
request suggested an iframe or embedded Chromium, with a global browser panel
usable from any terminal.

The initial combination of “web app only”, “arbitrary public URLs”, and
“DOM + screenshot” is not possible with browser APIs alone:

- Cross-origin iframe DOM access is blocked by the same-origin policy.
- `X-Frame-Options` and CSP `frame-ancestors` can prevent framing entirely.
- A normal web page cannot silently inspect or screenshot another tab’s DOM.
- `getDisplayMedia()` captures pixels only, requires a user gesture, and
  permission cannot be persisted.

The agreed V1 narrows the target to controlled development UIs:

- loopback targets (`localhost`, `127.0.0.1`, `::1`);
- active Cloudflare tunnel origins created by the connected DamHopper server;
- target applications opt into a dev-only inspection bridge;
- DamHopper remains the primary web UI; no browser extension required for V1;
- selection produces DOM/ARIA/locator metadata plus an optional screenshot;
- the user previews the result, chooses a terminal, and explicitly attaches it;
- bundle files are ephemeral and server-side so the xterm agent can read them.

## Existing implementation surface

The design should extend existing modules rather than introduce a second
terminal or transport architecture.

- `packages/ui/src/components/templates/IdeShell.tsx` and
  `packages/ui/src/types/ide.ts`: extensible `ToolWindowDef` / ActivityBar
  surface for a global Browser tool.
- `packages/ui/src/components/pages/WorkspacePage.tsx`: defines IDE and terminal
  mode tools and owns active terminal/workspace coordination.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx` and
  `TerminalFloatingToolPanel.tsx`: existing terminal-mode floating panel model.
- `packages/ui/src/lib/terminal-registry.ts`: imperative registry keyed by stable
  `sessionId`; appropriate target for “attach to selected terminal”.
- `packages/ui/src/hooks/use-terminal-manager.ts` and terminal layout modules:
  active/focused pane state, split layout, and session selection.
- `packages/ui/src/api/transport.ts`, `ws-transport.ts`, and
  `server/src/api/ws_protocol.rs` / `ws.rs`: typed `{kind: ...}` transport,
  terminal events, and server fan-out. No legacy `{type: ...}` messages.
- `server/src/tunnel/manager.rs` and `session.rs`: source of truth for active
  tunnel IDs/origins; do not trust arbitrary tunnel-looking hostnames.
- `packages/ui/src/lib/diagnostics-client.ts`: diagnostics integration, but
  captured DOM/text/images must stay out of diagnostics.
- `apps/web`: browser host. `apps/native`/Tauri remains remote-only in V1; no
  sidecar or new native capability is required.

## Evaluated approaches

### 1. Iframe plus cooperative bridge — selected V1

DamHopper embeds an opted-in local/tunnel app. A small dev-only bridge in the
target app handles hover/picker UI and sends a strict selection payload via
`postMessage`. The target must allow the DamHopper origin in framing policy.
DamHopper requests a current-tab screen capture after an explicit user action,
then crops the selected iframe region using the bridge’s element bounds.

Pros:

- stays in the existing web app;
- no extension or desktop install;
- works with project apps the team controls;
- DOM semantics come from the real page, not OCR or screenshots;
- screen capture preserves the actual rendered pixels.

Cons:

- target app integration is required;
- screenshot permission is explicit and may be denied;
- coordinate/DPR/zoom/scroll calibration needs careful testing;
- apps that disallow framing or do not include the bridge are unsupported.

### 2. Pure web Screen Capture API

Use `getDisplayMedia()` and let the user draw a rectangle over a captured tab or
window.

Useful as a fallback for uninstrumented pages, but it provides pixels and
coordinates only. It cannot produce reliable selectors, accessibility metadata,
or safe page actions. It should be a degraded “capture screenshot” mode, not
the primary semantic-debug workflow.

### 3. Chromium extension and Side Panel

An MV3 extension can inject a picker, inspect the active tab, capture the
visible tab, and optionally use scoped CDP commands. The Side Panel API provides
a persistent global browser panel. Chrome supports temporary `activeTab`
permission and content-script messaging, but content-script input must be
treated as untrusted.

This is the best Phase 2 path for unmodified local apps or the user’s normal
authenticated browser session, but it adds installation, permission UX, browser
packaging, and multi-browser maintenance.

### 4. Owned Chromium controlled by CDP

An existing Tauri host could launch a dedicated Chromium profile and use CDP
Overlay/DOM/Accessibility/Page domains. This gives strong semantic inspection
without modifying target apps, but it changes the host/runtime boundary and
does not reuse the user’s normal browser profile. It is a viable desktop
fallback if cooperative web previews prove insufficient, not the web V1.

### 5. Reverse proxy or Electron migration — rejected

Proxying arbitrary apps under DamHopper’s origin risks cookies, WebSockets,
service workers, CSP, absolute URLs, auth, and SSRF. Migrating the existing
Tauri application to Electron only for this feature duplicates a runtime and
creates a large Chromium security/update burden. Neither satisfies YAGNI/KISS.

## Recommended V1 behavior

1. Browser tool opens as a normal `ToolWindowDef`; it is available in both IDE
   and terminal workspace modes and does not own PTY lifecycle.
2. User enters an exact loopback or currently active DamHopper tunnel origin.
3. Browser panel verifies the origin against the connected server’s active
   tunnel registry and project configuration.
4. Target app bridge reports readiness. If framing or bridge checks fail, show a
   clear unsupported-state message; do not silently proxy or weaken CSP.
5. “Select UI” enables the target-side picker. Hover highlights elements; click
   returns a bounded payload.
6. Payload includes:

   - version, selection ID, timestamp;
   - origin, redacted URL, title;
   - tag, role, accessible name, bounded visible text;
   - allowlisted attributes and bounded locator candidates;
   - CSS-pixel bounds plus viewport/DPR metadata.

7. User explicitly starts “Share current tab” when a screenshot is wanted.
   DamHopper crops the iframe selection from the captured frame. If permission
   is denied, retain DOM-only mode.
8. Show a preview card with origin, text, locator, crop, size, and a warning that
   page content is untrusted.
9. User chooses a mounted/live terminal by stable `sessionId` and clicks
   “Attach to terminal”.
10. Server creates a short-lived, per-session JSON/PNG bundle outside the project
    tree. The UI inserts a quoted, sanitized context block containing the paths
    into the selected PTY. Never auto-submit or append Enter.
11. Expire bundles automatically and delete them on session/server cleanup.

Suggested selection shape:

```ts
interface BrowserSelectionV1 {
  version: 1;
  selectionId: string;
  capturedAt: string;
  page: { origin: string; url: string; title: string };
  element: {
    tag: string;
    role?: string;
    accessibleName?: string;
    text?: string;
    attributes: Record<string, string>;
    locatorCandidates: string[];
    bounds: { x: number; y: number; width: number; height: number };
  };
  screenshot?: { mime: "image/png"; bytes: number; bundlePath: string };
}
```

Exclude input values, password/file controls, cookies, storage, auth headers,
hidden surrounding DOM, event-handler attributes, full-page screenshots, and
unbounded HTML.

## Security and reliability boundaries

- Treat all page text and bridge messages as attacker-controlled prompt input.
- Validate `postMessage` source/origin, schema, selection ID, and active session ID.
- Use exact allowlisted origins; active tunnel origin only, never every
  `trycloudflare.com` host.
- Strip C0/C1 controls, ESC, OSC, and terminal escape sequences before PTY
  insertion; use bracketed paste where supported; never send Enter.
- Cap text, attribute, locator, screenshot, and bundle sizes.
- Keep captures out of client diagnostics and ordinary logs.
- Keep bundle retention short and expose an explicit “discard” action.
- Do not allow browser content to invoke arbitrary shell commands or server
  filesystem paths.
- Reject stale/unmounted/dead terminal targets using existing navigation rules.
- Screen Capture permission must be requested only from a user gesture; show
  capture state and stop tracks on close.

The browser constraints are documented by [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy),
[MDN `frame-ancestors`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors),
[MDN `getDisplayMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia),
and Chrome’s [content-script](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
[Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel),
and [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
documentation.

## Acceptance criteria

- Browser tool is reachable from IDE and terminal modes and survives tool
  switching without remounting terminals.
- Exact loopback origins and active server-created tunnel origins load; arbitrary
  public origins and inactive tunnel origins are rejected.
- An opted-in target can select an element and return the agreed bounded
  DOM/ARIA/locator payload.
- Screenshot flow requires an explicit user gesture, crops the selected region
  correctly at normal zoom and HiDPI, and degrades to DOM-only when denied.
- Preview shows the selected origin, metadata, crop, limits, and untrusted-data
  warning before any handoff.
- Attach targets the chosen stable terminal session, creates an expiring JSON/PNG
  bundle, inserts sanitized paths/context, and never submits a command.
- Prompt-injection text, terminal escapes, password fields, oversized payloads,
  stale terminal IDs, iframe navigation, reconnects, and tunnel shutdown fail
  safely.
- No captured content appears in diagnostics or persistent project files.

## Phased follow-up

1. Feasibility spike: cooperative bridge, iframe policy, screen-capture crop,
   nested frame/SPA navigation, zoom, and HiDPI.
2. V1 implementation: Browser tool, bridge protocol, origin registry, selection
   preview, ephemeral bundle, terminal attach, cleanup, and browser tests.
3. Hardening: hostile-page tests, prompt-injection fixtures, payload limits,
   capture denial, tunnel lifecycle, and accessibility.
4. Phase 2 extension: MV3 `activeTab` picker/Side Panel for unmodified local
   apps and normal browser sessions.
5. Phase 3 only if demand proves it: owned Chromium/CDP desktop flow or remote
   browser service.

## Unresolved questions

- Exact bundle TTL and maximum PNG/text sizes.
- Whether target bridge should be a standalone package, Vite plugin, or copied
  dev snippet.
- Whether AI agents later need a structured MCP resource in addition to terminal
  path insertion.

