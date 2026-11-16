# Host Browser Viewer & CDP Streaming: Viewer Boundaries

## 1. Executive Summary
DamHopper's current Browser OS app renders an unstreamed HTML `<iframe>` overlay parked in `OsBrowserKeepAliveHost`. Transitioning to a host-run Chromium CDP/JPEG canvas stream requires retiring the iframe slot and overlay machinery while resolving coupling with the browser extension picker, updating keepalive lifetime past React component unmount, and preserving independent HTML editor previews (`HtmlPreview.tsx`).

## 2. Active Browser Slot vs Independent Extension Workflow
- **Active OS Browser Slot (`packages/ui/src/os/`):**
  - `BrowserApp.tsx`: Renders slot placeholder `data-os-browser-slot={window.id}`, claims resource via `useResourceClaim` (`{resourceKind: "browser", profileId, generation, resourceId: previewUrl}`), calls `registerBrowserSlot` / `updateBrowserSlot`.
  - `OsResourceHost.tsx`: `OsBrowserKeepAliveHost` tracks `browserSlots` and renders fixed overlay `OsBrowserIframe` with `<iframe sandbox="allow-scripts allow-same-origin allow-forms" />` positioned via `ResizeObserver` / `getBoundingClientRect`.
  - *Cutover:* Remove `OsBrowserIframe`, `browserSlots`, `registerBrowserSlot`, `updateBrowserSlot`, and `OsBrowserKeepAliveHost`. Replace slot DOM node with an interactive `<canvas>` element connected to a root-managed stream controller.
- **Extension Bridge Coupling & Options (`apps/browser-extension/`, `packages/browser-bridge/`, `server/src/api/browser_debug.rs`):**
  - Current constraint: `apps/browser-extension/src/content.ts` checks `window.parent !== window` and installs the bridge only when framed inside DamHopper.
  - Streaming impact: A CDP canvas stream contains no framed target DOM in the client, breaking the extension's `postMessage` inspection, picker, and `BrowserSelectionV1` handoff on streamed targets.
  - *Cutover alternatives:*
    1. *Retain separate workflow:* Keep `BrowserDebugKeepAliveHost` / iframe host for cooperative target inspection only; streamed browser does not support DOM picker.
    2. *CDP-native inspection:* Re-implement DOM picker and selection over CDP (`Overlay.setInspectMode`, `DOM.describeNode`) to populate the existing backend `/api/browser-debug/artifacts` schema.
- **Editor HTML Preview (`packages/ui/src/components/organisms/HtmlPreview.tsx`):**
  - Sandboxed iframe (`srcDoc`) used by `HtmlHost.tsx` for `.html` file editing; fully independent, preserved as-is.

## 3. UI File Ownership & Cutover Inventory
| Category | File Path / Symbol | Action / Rationale |
|---|---|---|
| **Delete** | `packages/ui/src/os/OsResourceHost.tsx` (`OsBrowserIframe`, `browserSlots`, `register/updateBrowserSlot`, `OsBrowserKeepAliveHost`) | Retire iframe parking host and slot geometry listeners. Update doc references (`README.md`, `AGENTS.md`). |
| **Adapt** | `packages/ui/src/os/apps/BrowserApp.tsx` | Retain `BrowserTargetChooser`; replace slot div with streaming `<canvas>`; bind input listeners to root stream session. |
| **New** | `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` *(or root context)* | Maintain active stream controller / WebSocket keyed by `window.id` so stream survives component unmounts on desktop switch. |
| **Adapt Tests** | `packages/ui/browser-tests/os-lifecycle.browser.tsx:232-344` | Rewrite tests asserting `iframe[data-os-preview-iframe]` and DOM node identity across tile/float/desktop moves to assert stream continuity. |
| **Preserve** | `packages/ui/src/os/app-registry.ts:22-30` | `appId: "browser"`, `displayName: "Browser Preview"`, intents `browser:preview`, `browser:open`. |
| **Preserve** | `packages/ui/src/os/OsShell.tsx:659-673` | Intent handler dispatching `openWindow` for `browser:open`. |
| **Preserve** | `packages/ui/src/os/deep-links.ts` | Deep links parsing `url` query params into `browser:open` intent. |
| **Adapt** | `packages/ui/src/os/persistence.ts` | Current `{ url }` persistence re-navigates on reload; target session identity cannot resume raw across server restarts. |
| **Preserve** | `packages/ui/src/os/apps/PortsTunnelsApp.tsx` | Tunnel preview triggering `browser:open` intent. |
| **Preserve** | `packages/ui/src/components/organisms/HtmlPreview.tsx` | Independent Editor preview iframe. |
| **Preserve** | `server/src/browser_debug/` | Artifact storage and terminal PTY handoff backend API. |

## 4. Window Lifecycle, Input Arbitration & Security
- **Window Teardown vs Unmount Lifecycle:**
  - Component unmount occurs on desktop switch, minimize, and layout changes. Teardown of backend CDP targets **must not** bind to `BrowserApp` unmount.
  - Teardown must bind strictly to explicit window destruction via `closeWindow` (`packages/ui/src/os/window-ops.ts:333-363`) or `releaseAllForWindow`.
- **Recipes (`packages/ui/src/os/recipes/recipe-source-context.ts:97,306-314`):**
  - `isFleetUtility("browser")` is false, but `evaluateSourceWindow` excludes windows lacking `projectId`. Browser windows default to `minimumCtx: "profile"` (`app-registry.ts:26`), so they are excluded from project recipes unless explicit project context is attached.
- **Cognito Privacy Mode (`packages/ui/src/stores/cognito-mode.ts`):**
  - Keyboard: `packages/ui/src/os/input-arbiter.ts:118-121` emits `cognito-blocked`.
  - Pointer/Touch: `packages/ui/src/hooks/use-cognito-mode-input-guard.ts` intercepts and cancels all pointer/touch events.
  - Cutover requirement: Canvas stream rendering must blank and CDP input transmission must halt immediately when Cognito mode is active.
- **PIN Lock Screen (`packages/ui/src/os/LockScreenOverlay.tsx`, `input-arbiter.ts:123-125`):**
  - `lock-screen-blocked` prevents input passthrough; streaming frame delivery paused while locked.
- **Modals & Frame Operations (`packages/ui/src/os/WindowFrame.tsx`):**
  - Resize/drag overlay (`absolute inset-0 z-50`) blocks pointer events to underlying canvas during frame manipulation.

## 5. Remote Headless Browser Interaction Implications
- **Popups (`window.open` / `target="_blank"`):** Chromium emits `Target.targetCreated`. Client opens a new `BrowserApp` window via `openWindow` or adds to an in-app tab bar rather than spawning an unmanaged native window.
- **JavaScript Dialogs (`alert`, `confirm`, `prompt`):** Emit `Page.javascriptDialogOpening`. Host must render accessible in-app Radix dialogs and respond via `Page.handleJavaScriptDialog`.
- **File Chooser (`<input type="file">`):** Native OS dialogue unavailable in headless mode. Intercept via `Page.fileChooserOpened`; allow user to select files from DamHopper workspace and inject paths via `DOM.setFileInputFiles`.
- **Clipboard (`copy`, `paste`):** Streamed canvas lacks native text selection. Paste events on canvas forward text via CDP `Input.insertText`; copy requires synchronizing target selection with host clipboard.

## 6. Multi-Profile API Auth & Socket URL Construction
- Primary tokens scoped by `profileId` via `packages/ui/src/api/server-config.ts` (`damhopper_auth_token_${profileId}`).
- Dedicated streaming transport:
  - Option A: WebSocket with query auth (`/ws/browser?token=...&targetId=...`), matching `ws-transport.ts:2545-2548`.
  - Option B: Cookie/ticket pattern (`media-session.ts`), preventing token leakage in server access logs.
- Dedicated socket avoids head-of-line blocking on terminal PTY and filesystem message queues.

## 7. Remote Android Web SPA vs Native Excluded
- **Remote Android Web SPA (`apps/web` in mobile browsers):** INCLUDED. Consumes `packages/ui` OS shell; requires touch-to-mouse translation for canvas, coarse-pointer input handling, and virtual keyboard focus management.
- **Native Android Client (`native/android-app`):** EXCLUDED. Standalone Kotlin Multiplatform / Compose app; connects directly to backend REST/WS for terminals, git, and files; does not run React OS shell or `BrowserApp`.

## 8. Verification Commands Found (Not Run)
- Rust Server Tests: `cargo test` / `pnpm test`
- Shared Package Tests: `pnpm --filter @dam-hopper/shared test`
- Browser Bridge Tests: `pnpm --filter @dam-hopper/browser-bridge test`
- UI Unit Tests: `pnpm --filter @dam-hopper/ui test` (`vitest run`)
- UI Browser Tests: `pnpm --filter @dam-hopper/ui test:browser` (`vitest run --config vitest.browser.config.ts`)
- UI E2E Playwright Tests: `pnpm --filter @dam-hopper/ui test:e2e` (`playwright test`)
- Android Native JVM Tests: `pnpm android:test` (`node scripts/run-gradle.mjs :shared:jvmTest`)
- All Suites Runner: `scripts/run-all-tests.sh`

## 9. Unresolved Questions
1. Should DOM element selection/inspection be ported to CDP (`Overlay.setInspectMode`) to preserve terminal artifact handoff on streamed pages, or should browser debug remain an iframe-only developer tool?
2. Should multi-tab/popup Chromium targets be surfaced as independent DamHopper OS windows or as internal tabs inside a single `BrowserApp` window?
3. Should the dedicated browser streaming WebSocket authenticate via query token (`/ws/browser?token=...`) or via session ticket/cookie (`/api/fs/media-session` style) to prevent token leakage in proxy/server logs?
