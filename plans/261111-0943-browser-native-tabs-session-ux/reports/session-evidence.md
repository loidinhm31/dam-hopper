# Browser Host & OS Session Evidence Report

**Document**: `plans/261111-0943-browser-native-tabs-session-ux/reports/session-evidence.md`  
**Date**: 2026-11-11  
**Repository Branch**: `feat/ai-os-redesign`  
**Purpose**: Map OS window persistence, browser session lifecycle, principal ownership, survival semantics, and evaluate existing paths vs new backend registry for native-browser-like multi-tab UI/UX.

---

## 1. List-Authority Shape & Contract

### 1.1 Backend Authority (`BrowserSessionDto`)
Source: `server/src/browser_host/session.rs:160-180`, `server/src/api/browser_host.rs:404-430`.
- Endpoint: `GET /api/browser/sessions` -> `list_sessions(&admission.principal)`
- Status authority: In-memory `SessionRegistry` (`server/src/browser_host/session.rs:1287-1295`), filtered by `owner_principal == principal && status != SessionStatus::Closed`.
- DTO structure returned:
```json
{
  "browserSessionId": "uuid-string",
  "browserIncarnation": "uuid-string",
  "profileEpoch": "1",
  "navigationRevision": "1",
  "viewportEpoch": "1",
  "url": "https://example.com",
  "title": "Example Domain",
  "status": "running", // "initializing" | "running" | "closing" | "lost" | "closed"
  "geometry": {
    "cssWidth": 1280.0,
    "cssHeight": 900.0,
    "offsetTop": 0.0,
    "scrollX": 0.0,
    "scrollY": 0.0,
    "pageScale": 1.0,
    "visualOffsetX": 0.0,
    "visualOffsetY": 0.0,
    "dpr": 1.0
  },
  "inputAvailable": true,
  "unavailableReason": null,
  "dialog": null,
  "lease": {
    "viewerId": "string",
    "holderKind": "human",
    "expiresAtUnixMs": 1731300000000
  },
  "popupBlocked": false,
  "activePopupSessionId": null,
  "parentSessionId": null
}
```

### 1.2 Frontend Window App State vs Backend Authority
Source: `packages/ui/src/os/persistence.ts:56-62`, `packages/ui/src/os/apps/BrowserApp.tsx:186-196`.
- Window-persisted appState in `localStorage`:
  ```json
  {
    "url": "https://example.com",
    "sessionId": "uuid-string",
    "logicalSessionId": "uuid-string"
  }
  ```
- Stripped on persistence (`sanitizeAppState` in `persistence.ts:56-62`): `viewerId`, `leaseToken`, `isController`, `browserIncarnation`, `profileEpoch`, `geometry`, `navigationRevision`, `viewportEpoch`, tickets, audio state, and dialog state are never persisted. They are pure runtime authority.

---

## 2. OS Persistence & Window Lifecycle

### 2.1 Sanitizer, Import, and Export
- **Sanitizer (`packages/ui/src/os/persistence.ts:56-62, 193-247`)**:
  - `sanitizeAppState("browser", rawState)` projects only `url`, `sessionId`, and `logicalSessionId`.
  - Window contexts (`profileId`, `projectId`, `worktreeId`) and `floatBounds` / `restorePlacement` are strictly validated and clamped.
- **Export Envelope (`packages/ui/src/os/persistence.ts:786-811`)**:
  - `exportOsEnvelope(session)` exports envelope `version: 1`, bundling `session` (sanitized), `dock` pins, `shortcuts`, and `notifications_prefs`.
- **Import Envelope (`packages/ui/src/os/persistence.ts:813-900`)**:
  - Validates `version: 1`, runs candidate session through `validateOsSession` (`persistence.ts:278-352`) and `sanitizeSessionForPersistence`.

### 2.2 Explicit Window Close
Source: `packages/ui/src/os/window-store.ts:140-171`.
- When an OS window is explicitly closed (`closeWindow(windowId)`):
  - Checks if `win.appId === "browser"`.
  - Extracts `sessionId = win.appState?.sessionId`.
  - Fires `void closeBrowserSession(owner, sessionId)` (`window-store.ts:163-165`), issuing `DELETE /api/browser/sessions/{id}` to the server.
  - Backend closes the native Chromium target via CDP `Target.closeTarget`, revokes attachment tickets, and frees the session slot.
  - Removes the window from `useWindowStore` state and desktop tiling tree.

### 2.3 Recipes
Source: `packages/ui/src/os/recipes/schema.ts:295-299, 431-435`, `packages/ui/src/os/recipes/recipe-engine.ts:250-254`.
- When an OS window configuration is saved as a Recipe:
  - `s.appId === "browser"` explicitly keeps **only** `{ url: s.appState.url }`.
  - `sessionId` and `logicalSessionId` are discarded to ensure launch recipes instantiate fresh browser sessions rather than linking to retired sessions.

---

## 3. Session Backend Process & Profile Lifecycle

### 3.1 Session Operations
Source: `server/src/api/browser_host.rs:404-567`, `server/src/browser_host/session.rs`.
- **List** (`GET /api/browser/sessions`): Authenticates principal, returns `Vec<BrowserSessionDto>` from in-memory `GLOBAL_SESSION_REGISTRY`.
- **Create** (`POST /api/browser/sessions`):
  - Request: `CreateSessionRequest { creation_key: Uuid, url: String, viewport: ViewportRequest }`.
  - Pre-validates navigation URL against network policy (rejects link-local, private cloud metadata IP destinations `169.254.169.254`, `fd00:ec2::254`, etc., unless dev mode).
  - Calls `manager.ensure_running(&principal, is_dev)` to boot or connect to Chromium.
  - Allocates session slot in `SessionRegistry::reserve_creation` with creation marker URL `about:blank#dh-<browserSessionId>`.
  - Dispatches CDP `Target.createTarget`, configures viewport/DPR, attaches media/screencast producer, commits status `Running`.
- **Get / Status** (`GET /api/browser/sessions/{id}`): Returns `BrowserSessionDto` + active text/DOM selection summary. Fails closed with 404 if caller principal does not own the session.
- **Close** (`DELETE /api/browser/sessions/{id}`): Initiates `close_native_session`, dispatches CDP `Target.closeTarget`, marks session `Closed`, cancels active tickets in `AttachmentManager::revoke_by_browser_session`, removes input manager.

### 3.2 Principal Isolation & Profile Lifecycle
Source: `server/src/browser_host/profile.rs`, `server/src/browser_host/manager.rs`.
- **Directory Layout**:
  - `~/.config/dam-hopper/browser-profiles/{prod|dev}/{sha256(subject)}/`
  - Mode `0700` for user data directory (`user-data/`).
  - Files: `manager.lock` (flock advisory OS lock), `metadata.json` (durable metadata), `reset_tombstone.json` (atomic reset tracking).
- **Process Management**:
  - Exactly one Chromium process per principal + `is_dev` namespace.
  - Launched headless (`BrowserProcess::launch` in `process.rs:320-380`).
  - Contains process group id (pgid) and pre-launch `launch_token` for containment proof.
  - Assigns unique `browser_incarnation = Uuid::new_v4().to_string()` per process boot.
  - On shutdown or launch reconciliation, `reap_prior_tree` sends `SIGTERM` followed by `SIGKILL` to clean orphan trees before acquiring locks.

---

## 4. Survival & Hazard Matrix

| Event | Frontend OS Window State | Backend Session Memory | Chromium Engine & Tabs | Chromium Profile / Cookies / Cache | Reconnect / Recovery Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend Reload** | **Survives** (`localStorage`) | **Survives** | **Survives** | **Survives** | On mount, `BrowserStreamKeepAliveHost` fetches `getBrowserSession`. If status `running`, re-mints viewer tickets, re-attaches stream. Gapless. |
| **Close Window** | **Removed** | **Destroyed** (`DELETE` called) | **Target Closed** | **Survives** | Explicit close calls `closeBrowserSession`. CDP target closed; cookies and storage stay on disk. |
| **Browser Close** (host client tab) | **Survives** (`localStorage`) | **Survives** | **Survives** | **Survives** | No beforeunload close. Chromium target and backend memory remain alive. Reconnecting reattaches seamlessly. |
| **Network Reconnect** | **Survives** | **Survives** | **Survives** | **Survives** | Connection `generation` bumps. `BrowserStreamKeepAliveHost` re-evaluates claim, mints fresh attachment tickets, reconnects WebSocket stream without touching Chromium DOM. |
| **Server Restart** | **Survives** (`localStorage`) | **Destroyed** (in-memory) | **Destroyed** (`reap_prior_tree`) | **Survives** (persisted on disk) | `getBrowserSession` returns 404. UI shows `unsupportedReason: "Browser session no longer exists on this host"`. Navigating creates fresh session reusing on-disk profile/cookies. |
| **User Logout** (device session) | **Cleared** on UI reset | **Revoked** | **Survives** (unless reset requested) | **Survives** | `revoke_auth_session_browser_resources` drops tickets and input leases. Cookies retained on disk unless `browser_reset: true` explicitly passed. |
| **User Reset** (`/api/browser/profile/reset`) | **Fenced** | **Destroyed** | **Terminated** | **Destroyed** (wiped & epoch bumped) | All active sessions fenced, Chromium killed, `user-data/` unlinked and recreated, `profile_epoch` incremented. Audio/video immediately silenced. |

---

## 5. Architectural Decision: Existing Paths vs New Backend Registry

### Decision: Reuse Existing Paths (NO new backend registry)
- **Rationale**:
  1. The backend `SessionRegistry` (`server/src/browser_host/session.rs`) is ALREADY a multi-target registry capable of holding multiple independent sessions per principal.
  2. The REST API (`/api/browser/sessions`, `/api/browser/sessions/{id}`, navigate, history, reload, attachments) ALREADY accepts arbitrary `browserSessionId` values.
  3. The current "one session per OS window" restriction is strictly a frontend state and rendering construct in `window-store.ts`, `persistence.ts`, and `BrowserApp.tsx`.
  4. Introducing a secondary backend registry would introduce duplicate book-keeping, synchronization races, and violate YAGNI/KISS principles.

---

## 6. Current Limits & Hazards

### 6.1 Capacity Limits
Source: `server/src/browser_host/config.rs:8-16`.
- `DEFAULT_MAX_TARGETS = 2`:
  - Shared across all REST sessions, OAuth popup windows, and raw CDP pages for the instance.
  - Attempting to create a 3rd tab will trigger `SessionError::Busy("target capacity reached (2/2)")`.
  - *Material requirement*: Planning native tabs must address this budget ceiling (e.g. bumping `DEFAULT_MAX_TARGETS` or making it dynamically configurable for multi-tab workflows).
- `DEFAULT_MAX_VIEWERS = 2`:
  - Up to 2 concurrent streaming viewers. In multi-tab mode, only the active foreground tab should hold a streaming viewer ticket (`media` + `control`), avoiding viewer ticket exhaustion.
- `DEFAULT_MAX_PROCESSES = 1`:
  - Exactly 1 browser process per principal. All tabs in that principal's workspace share the same Chromium instance and cookie jar.

### 6.2 URL Privacy & Cognito Protection
Source: `packages/ui/src/os/apps/BrowserApp.tsx:239-243`, `BrowserStreamKeepAliveHost.tsx:1312`.
- When Cognito Privacy Mode is active:
  - `isVisible` is forced to `false`.
  - Stream controller detaches or pauses; video frame canvas is blanked.
  - Tab audio is synchronously muted/zeroed.
  - Text input proxy loses focus.
  - Window frame and tabs must render blurred/masked titles and URLs.

### 6.3 Stale Runtime Hazards & Authority Fences
Source: `packages/ui/src/os/browser-session-sync.ts:26-85`.
- **`browserIncarnation`**: UUID changed upon server restart or Chromium crash. Any command sent with mismatched incarnation is rejected.
- **`profileEpoch`**: Monotonically increasing u64. Prevents cross-talk after a profile reset.
- **`navigationRevision`**: CAS revision guarding `POST /navigate`. Prevents out-of-order URL override.
- **`viewportEpoch`**: Monotonically increasing u64 guarding resize and touch coordinates.
- **`generation`**: Frontend connection epoch. Guards ticket issuance and claim attachment.

---

## 7. Minimum Frontend Tab Persistence Architecture

To transition from "one session per OS window" to native-browser-like multi-tab UI without backend restructuring:

1. **Window State Schema (`OsWindow.appState`)**:
   ```ts
   interface BrowserAppState {
     tabs: Array<{
       tabId: string;
       sessionId?: string;
       url: string;
       title?: string;
     }>;
     activeTabId: string;
     // Backwards-compatible fallback:
     url?: string;
     sessionId?: string;
   }
   ```
2. **Sanitizer (`packages/ui/src/os/persistence.ts:56-62`)**:
   - Update `sanitizeAppState("browser", ...)` to project `tabs: [{ tabId, sessionId, url }]` and `activeTabId`.
3. **Keep-Alive & Streaming Attachment**:
   - Only the **active tab** (`activeTabId`) attaches to `BrowserStreamKeepAliveHost` (viewing stream, acquiring control, playing audio).
   - Inactive tabs remain alive in the backend Chromium engine (holding cookies, state, execution) with zero streaming overhead.
4. **Explicit Tab Close**:
   - Closing an individual tab sends `DELETE /api/browser/sessions/{tabSessionId}`.
   - Closing the OS window sends `DELETE` for all remaining tabs in `win.appState.tabs`.
5. **Restart Recovery Limits**:
   - If server restarts, backend returns 404 for existing session IDs.
   - Frontend detects 404 on active tab activation, displays clean re-open / refresh action, or lazily triggers `POST /api/browser/sessions` with the tab's saved `url`. Cookies/logins survive in Chromium profile.

---

## 8. Verification Tests & Commands

### Rust Backend Tests
```sh
cargo test --manifest-path server/Cargo.toml test_browser_host
cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle
cargo test --manifest-path server/Cargo.toml --test browser_host_media
cargo test --manifest-path server/Cargo.toml --test browser_host_admission
cargo test --manifest-path server/Cargo.toml --test browser_host_auth
cargo test --manifest-path server/Cargo.toml --test browser_host_logout
```

### Frontend UI Vitest Tests
```sh
pnpm --filter @dam-hopper/ui test src/os/persistence.test.ts
pnpm --filter @dam-hopper/ui test src/os/window-ops.test.ts
pnpm --filter @dam-hopper/ui test src/os/browser-session-sync.test.ts
pnpm --filter @dam-hopper/ui test src/os/apps/BrowserApp.test.tsx
pnpm --filter @dam-hopper/ui test src/os/BrowserStreamKeepAliveHost.test.tsx
```

---

## 9. Status & Unanswered Decisions

### Complete
- [x] OS persistence mappings (sanitizer, import/export, window store close, recipe engine).
- [x] Backend session REST endpoints & process lifecycle mapped.
- [x] Restart recovery, connection generation, and survival matrix mapped.
- [x] Architecture decision settled: reuse existing backend paths; no new backend registry.
- [x] Identified minimum frontend tab persistence architecture and hazards.

### Unanswered Material Decisions
1. **Target Budget Ceiling**: Default `max_targets = 2` (`config.rs:9`). In a multi-tab workflow, opening >2 tabs will fail with HTTP 429 (`targetCapacityReached`). Should the default `max_targets` budget be increased (e.g. to 6 or 10) in server defaults, or should inactive tabs be aggressively parked/closed?
2. **Background Tab Keep-Alive vs Eviction**: Should tabs in the background stay running indefinitely in Chromium, or should an LRU discard mechanism exist when approaching `max_targets`?
3. **Tab Audio Multiplexing**: Currently, audio is streamed per-session. Background tabs might emit audio (e.g. YouTube background tab). Does the native tab experience require background audio or mute-when-inactive?
