# Scout Report: Frontend State, Transport, Contracts & Capabilities

**Report Path**: plans/reports/scout-261005-1653-frontendstate.md
**Date**: 2026-10-05
**Monorepo Packages Audited**: packages/ui, packages/shared, packages/browser-bridge
**Environment**: Linux x64, pnpm monorepo, Node / Vite / React 19

---

## 1. Directory & Symbol Map

### 1.1 Entry Points & Package Manifests
- **packages/ui/package.json**:
  - Version: 0.10.2.
  - Actual Entry File: packages/ui/src/index.ts does not exist.
  - Package exports define canonical entries:
    - ".": ./src/embed/dam-hopper-app.tsx (DamHopperApp embed root, routing, provider trees, lazy pages).
    - "./styles": ./src/index.css.
    - "./api/*": ./src/api/*.ts.
    - "./lib/*": ./src/lib/*.ts.
    - "./diagnostics-client": ./src/lib/diagnostics-client.ts.
    - "./advisor": ./src/advisor/index.ts.
    - "./advisor/*": ./src/advisor/*.ts.
  - Critical React 19 dependencies: @radix-ui/* dependencies patched via pnpm (patches/@radix-ui__react-compose-refs@1.1.2.patch (repository patches/ directory contains only @radix-ui__react-compose-refs@1.1.2.patch and empty patch.txt)).

- **packages/shared/**:
  - Manifest: packages/shared/package.json (version: 0.10.2, exports "." -> ./src/index.ts, "./logger" -> ./src/logger.ts).
  - src/index.ts: Re-exports logger module.
  - src/logger.ts: Universal structured logger (logger), log levels (debug, info, warn, error, silent), console sink, custom sink registry (addLoggerSink), and sensitive pattern redaction (redactLogMetadata, masks tokens, passwords, passphrases, API keys, credentials).
  - src/ssh-forward-contract-fixtures.json: Wire test fixtures for native SSH forward protocol.

- **packages/browser-bridge/**:
  - Manifest: packages/browser-bridge/package.json (version: 0.10.2, exports "." -> ./src/index.ts).
  - src/index.ts: Entry exporting installBrowserBridge, isAllowedParentOrigin.
  - src/protocol.ts: Protocol constants (BROWSER_BRIDGE_VERSION = 1), envelope schemas, commands (dam-hopper:connect, start-picker, stop-picker, go-back, go-forward, reload), events (bridge-ready, selection, navigation, console, error).
  - src/bridge-channel.ts: createPostMessageBrowserBridgeChannel target channel abstraction.
  - src/extension-presence.ts: Extension presence marker on document.documentElement (data-dam-hopper-browser-debug="1") and window event dam-hopper:browser-extension-ready.
  - src/picker.ts: Visual element picker and selector generator (depth limit 6, locator max 512 chars).
  - src/browser-observers.ts: DOM console interception (console.debug|log|info|warn|error) and navigation observer (popstate, hashchange, history pushState wrapping).

### 1.2 packages/ui/src/api/ (Transport, Ownership, Queries & Config)
- **ownership.ts**:
  - Strict ownership hierarchy: ProfileId, ConnectionRef ({ profileId, generation }), ProjectRef ({ profileId, project }), ProjectTargetRef (ProjectRef & { worktreePath?: string | null }), TerminalRef ({ profileId, id }), TerminalInstanceRef (TerminalRef & { incarnation: number }).
  - Tuple serialization helpers: projectKey, projectTargetKey, terminalKey, terminalInstanceKey, connectionKey (all formatted as JSON arrays, e.g. JSON.stringify([profileId, project])).
  - Wire projection: toServerProjectTarget projects target to server payload, explicitly stripping client-only profileId.
  - Invariants: assertOwnerMatch, isOwnerMatch, ConnectionOwnerError.
- **transport.ts**:
  - Singleton transport contract Transport.
  - Transport replacement & generation notification: initTransport, reconfigureTransport, getTransportGeneration, subscribeTransportChanges.
- **connections.ts**:
  - Multi-profile connection registry (entries: Map<ProfileId, ConnectionEntry>).
  - Connection snapshot management: ConnectionSnapshot, getConnectionSnapshot, getAllConnectionSnapshots, useConnectionSnapshot.
  - Profile connection lifecycle: connectProfile, disconnectProfile, captureConnection(profileId), isCurrentConnection(owner).
  - Ambient transport sync: syncActiveProfileConnection updates ambient _transport; disconnectProfile checks ownsAmbient before falling back to IdleTransport.
- **ws-transport.ts**:
  - Browser/web transport connecting to /ws with {kind: "..."} WebSocket messages and REST fetch with Authorization: Bearer.
  - Subscriptions: onTerminalData, onTerminalBuffer, onTerminalExit, onTerminalExitEnhanced, onTerminalLifecycle, onProcessRestarted, onFsOverflow, onEvent, onStatusChange.
  - Actions: terminalWrite, terminalResize, terminalAttach(id, fromOffset).
- **idle-transport.ts**:
  - Safe fallback transport when no server profile is active; rejects invocations with "Server profile required".
- **client.ts**:
  - High-level typed API client: createApiClient(owner, transport) -> ApiClient.
  - Ambient fallback: export const api = createApiClient({ profileId: "", generation: 0 }, defaultAmbientTransport).
- **query-client.ts**:
  - Query key scoping: profileQueryKey(owner, ...parts) yielding ["profile", owner.profileId, owner.generation, ...parts].
  - Invalidation prefixes: profileQueryPrefix(profileId) (["profile", profileId]), profileGenerationQueryPrefix(owner) (["profile", profileId, generation]).
- **queries.ts**:
  - TanStack React Query hooks for workspace, projects, worktrees, git operations, host metrics, terminals, usage, agent store, memory templates.
- **host-resource-stream-coordinator.ts**:
  - Owns cancellable SSE streams (/api/system/resources/v1/events) per captured ConnectionRef.
  - Source modes: STOPPED, STARTING, LIVE, RETRY_WAIT, REST_ONLY, AUTH_BLOCKED, PAUSED.
  - BFCache & visibility listeners (visibilitychange, pagehide, pageshow).
- **host-resource-sse-parser.ts & host-resource-sse-codec.ts**:
  - Chunked SSE line parser and binary/text decoder with freshness tracking.
- **server-config.ts**:
  - Profiles persistence (damhopper_server_profiles), active profile (damhopper_active_profile_id), auth tokens (damhopper_auth_token, damhopper_profile_auth_v2_<id>), profile change events (damhopper:profile-changed).
- **auth-client.ts & auth-types.ts**:
  - Authentication status inspection (checkAuthStatus), MFA step-up verification (requestMfaStepUpChallenge, verifyMfa).

### 1.3 packages/ui/src/stores/ (State Management & Persistence)
- **workspace.ts**: dam-hopper:workspace-state (v1); stores selectedProject: { profileId, project }. Cleans up legacy dam-hopper:active-project on rehydration.
- **git-history.ts**: dam-hopper:git-history-state (v1); stores gitPageSelection (tuple-keyed array), rootByTarget, branchByScope, selectionRecoveryRequired. Listens to profile deletion events.
- **editor.ts**: dam-hopper:editor-state (v2); stores open tabs, active tab keys per target scope, file tiers (normal, degraded, large, binary, video, image, diff).
- **explorer-tree.ts**: dam-hopper:explorer-tree-state (v1); maps expanded directory paths per target scope key.
- **workbench-selections.ts**: dam-hopper:preferences-source:v1 and dam-hopper:settings-target:v1; tracks active preferences profile ID, snapshot cache, browser target profile.
- **settings.ts**: In-memory Zustand store syncing with backend via hydrate/save; caches offline snapshot in workbench-selections.
- **cognito-mode.ts**: In-memory Zustand store for privacy mode (active: boolean, activationShortcut: string | null).
- **project-target.ts**: In-memory Zustand store managing active worktree selection and unavailable target reconciliation.
- **agent-status.ts**: In-memory Zustand store tracking profile agent status snapshots, attention cursors ({ incarnation, revision }), push events.
- **terminal-notifications.ts**: In-memory Zustand store for terminal agent notifications (max 50 history, max 3 toasts).
- **search-ui.ts**: In-memory Zustand store for search modal state, query strings, replace query, search mode (content | filename).

### 1.4 packages/ui/src/contexts/ & packages/ui/src/types/
- **Contexts**:
  - WorkspaceAdvisorContext.tsx: Placement slot descriptor registry for Advisor panel.
  - BrowserDebugHostContext.tsx: Environment (web | native) and host instance provider.
  - AndroidChromeInputPolicyContext.tsx: Policy provider applying virtual keyboard input isolation for Android Chrome.
  - AppZoomContext.tsx: Zoom level management (50%–120%).
  - EncryptContext.tsx: OPAQUE session key and passphrase prompt queue for encrypted filesystem writes.
  - SshForwardHostContext.tsx: Native desktop SSH forwarding host provider and profile bridge.
- **Types**:
  - terminal-layout.ts: Binary-tree split layout (SplitNode, PaneNode, DockTarget, PersistedLayout v1/v2).
  - ide.ts: Activity bar tool window descriptors (ToolWindowDef).

### 1.5 packages/ui/src/lib/ (Core Utilities & Engine Modules)
- **fresh-state-reset.ts**: Idempotent reset for obsolete v1/unowned local storage keys (marker dam-hopper:fresh-reset-v2-applied).
- **crypto.ts**: Client AES-256-GCM envelope encryption (encryptFile, encryptText), IV (12 bytes), tag (16 bytes), key zeroing.
- **opaque-client.ts & opaque-session.ts**: WebAssembly OPAQUE client protocol (@serenity-kit/opaque) for zero-knowledge key derivation.
- **cognito-mode-events.ts**: 38 suppressed DOM event types during Cognito Privacy Mode.
- **android-chrome-input-policy.ts**: Android Chrome virtual keyboard input focus trap and suppression policy.
- **shortcuts.ts**: Global keyboard shortcut parser, modifiers (Mod, Ctrl, Alt, Shift), DoubleShift detector.
- **terminal-stream-replay-gate.ts**: Gates terminal outbound traffic during buffer replay to prevent query reply leaks; offset reconciler.
- **terminal-buffer-replay.ts**: Replay buffer executor for reconnected terminal sessions.
- **terminal-attach-recovery-controller.ts**: Reconnection and retry controller for terminal PTY attachments.
- **terminal-registry.ts**: Module-level imperative registry for xterm instances, fit addons, and find controllers (never stored in React state).
- **git-squash-selection.ts**: Validates parent-contiguous linear commit chains for squashing.
- **git-branch-ref.ts**: Canonical ref parser (refs/heads/*, refs/remotes/*) and history branch resolver.
- **file-tier.ts**: File size tier thresholds (1MB degraded, 5MB large viewer, binary, media).
- **diagnostics-client.ts**: Ring-buffer diagnostic event collector (capped at 512 KiB, 1000 items, 1-hour retention).
- **app-zoom.ts**: Persisted UI zoom configuration (dam-hopper:app-zoom:v1).

---

## 2. Runtime & Data Flow

### 2.1 Multi-Profile Connection Lifecycle & Generation Isolation

1. Each connection has a unique ConnectionRef { profileId, generation }.
2. Connection reconnects increment generation, which instantly invalidates all associated React Query cache keys (profileGenerationQueryPrefix) without cross-profile interference.
3. Ambient transport fallback: When disconnecting a secondary profile, disconnectProfile only swaps ambient _transport to IdleTransport if the disconnecting profile currently owns ambient transport.

### 2.2 Terminal Stream Continuity & Replay Gating

1. On reconnect, terminalAttach(id, fromOffset) is dispatched via WebSocket.
2. Server responds with terminal:buffer containing historical bytes, offset, truncation flag, and incarnation.
3. TerminalStreamReplayGate blocks outbound data generated by xterm (e.g. cursor position reports or device attribute responses) to avoid corrupting the server PTY during replay.
4. Live incoming chunks overlapping with the replayed buffer are sliced or discarded via reconcileTerminalOutput.

### 2.3 Host Resource Streaming & SSE BFCache Resiliency
1. Profile-owned SSE stream connects to /api/system/resources/v1/events.
2. HostResourceStreamCoordinator handles 7 source modes (STOPPED, STARTING, LIVE, RETRY_WAIT, REST_ONLY, AUTH_BLOCKED, PAUSED).
3. Browser BFCache handling: Chrome 149+ terminates active WebSockets in BFCache. HostResourceStreamCoordinator listens to pageshow and visibilitychange to resume or recreate the stream coordinator scoped to { profileId, generation }.
4. Host resource polling (1s interval) is active exclusively when a specific profile drilldown is visible.

### 2.4 Cognito Privacy Mode & Input Guard
1. Triggered by global shortcut Mod+Alt+KeyB (customizable).
2. Sets active = true in useCognitoModeStore.
3. useCognitoModeInputGuard installs nonpassive window-capture event listeners (capture: true) intercepting 38 pointer, keyboard, clipboard, wheel, and drag event types (BLOCKED_POINTER_EVENTS).
4. Productive DOM nodes are marked inert and aria-hidden="true", preventing focus leaking or keyboard shortcuts triggering background actions.
5. Overlay displays configurable visual mask (heavy-blur with backdrop filter or solid black-screen).

### 2.5 Encrypted Upload & Save Pipeline
1. Session-based OPAQUE challenge initiated via @serenity-kit/opaque (opaqueLoginStart -> finishLogin).
2. Client receives session key, imports it into Web Crypto API as non-extractable AES-256-GCM key (importAesKey), and zeroes memory buffers.
3. Plaintext payload is composed as: JSON_METADATA + 0x00 + CONTENT_BYTES.
4. Encrypted using 12-byte random IV (randomIv) and 16-byte authentication tag.
5. Uploaded via fs:put_file or fs:put_save.

---

## 3. Authoritative Commands, Config & Contracts

### 3.1 LocalStorage Keys & Persistence Schema
| Key | Version | Store / Module | Purpose |
| :--- | :--- | :--- | :--- |
| damhopper_server_profiles | Array | server-config.ts | List of server profiles (id, name, url, authType, autoConnect). |
| damhopper_active_profile_id | String | server-config.ts | Currently focused profile ID. |
| damhopper_auth_token | String | server-config.ts | Legacy ambient auth token. |
| damhopper_profile_auth_v2_<id> | 2 | server-config.ts | Scoped token storage per profile. |
| dam-hopper:workspace-state | 1 | workspace.ts | Selected project (profileId, project). |
| dam-hopper:git-history-state | 1 | git-history.ts | Selected project keys, roots by target, branch by scope. |
| dam-hopper:editor-state | 2 | editor.ts | Tabs, active tab keys per target scope. |
| dam-hopper:explorer-tree-state | 1 | explorer-tree.ts | Open directory map per target scope. |
| dam-hopper:preferences-source:v1 | 1 | workbench-selections.ts | Selected profile for preferences sync and offline snapshot. |
| dam-hopper:settings-target:v1 | 1 | workbench-selections.ts | Settings target profile ID. |
| dam-hopper:terminal-layout:v3:<scope> | 3 | use-terminal-layout.ts | Split layout tree for terminals. |
| dam-hopper:app-zoom:v1 | 1 | app-zoom.ts | UI zoom level (50–120). |
| damhopper_diagnostics_frontend_v1 | 1 | diagnostics-client.ts | Ring-buffer logs and diagnostic snapshots (max 512 KiB). |
| dam-hopper:fresh-reset-v2-applied | Marker | fresh-state-reset.ts | Prevents re-running legacy key eviction. |

### 3.2 Wire Contracts
- **WebSocket Envelope**: Strict { kind: string, ... } payload (Phase 02 cutover; legacy { type: string } envelope rejected).
- **REST Endpoints**: /api/* authenticated via Authorization: Bearer <token>.
- **SSE Stream**: /api/system/resources/v1/events responding with text/event-stream.
- **Browser Bridge Protocol**: Version 1, payload envelope { version: 1, nonce: string, requestId: string, type: string }.

---

## 4. Product Capabilities & Limits

- **File Tiers**:
  - < 1 MB: Normal Monaco editor.
  - 1 MB – 5 MB: Degraded Monaco (minimap, folding, word wrap disabled).
  - >= 5 MB: Large file viewer (chunked range-read via IntersectionObserver).
  - Binary files: Binary viewer (hex dump).
  - Media: Image viewer (native preview) and Video viewer (stream ticket playback).
- **Git Operations**:
  - Page size: 200 commits per fetch.
  - Search debounce: 300 ms with IME composition gating.
  - Squash: Requires linear parent-contiguous chain without merge commits; checks commit signature discard consent.
  - Leased push: CAS verification on local root OID and remote target ref OID.
- **Advisor Subsystem**:
  - Admin only; disabled by default.
  - Policy update payload limit: 16 KiB.
  - Model ID string limit: 256 bytes; reasoning effort limit: 64 bytes.
  - Model introspection: 5s timeout, 2-permit concurrency semaphore, 5 MiB stdout buffer cap.
- **Diagnostics Client**:
  - Buffer retention: 60 minutes.
  - Storage ceiling: 512 KiB.
  - Max entries: 1,000 entries.

---

## 5. Documentation Updates Needed

1. **Fix Missing packages/ui/src/index.ts References**:
   - Evidence: packages/ui/package.json specifies ".": "./src/embed/dam-hopper-app.tsx"; packages/ui/src/index.ts is absent on disk.
   - Update: All documentation referencing packages/ui/src/index.ts as the frontend entry point must be corrected to point to packages/ui/src/embed/dam-hopper-app.tsx and specific export subpaths (./api/*, ./lib/*, etc.).
2. **Multi-Profile Concurrent Workbench Architecture**:
   - Evidence: packages/ui/src/api/ownership.ts, packages/ui/src/api/connections.ts, packages/ui/src/api/query-client.ts.
   - Update: Document tuple serialization ([profileId, project], [profileId, generation]) and ambient transport decoupling.
3. **Cognito Privacy Mode**:
   - Evidence: packages/ui/src/stores/cognito-mode.ts, packages/ui/src/hooks/use-cognito-mode-input-guard.ts, packages/ui/src/lib/cognito-mode-events.ts.
   - Update: Document the 38-event capture-phase guard, DOM inert application, and overlay styling options.
4. **Retired Plugin System vs Native Advisor**:
   - Evidence: packages/ui/src/advisor/, packages/ui/src/hooks/use-advisor.ts, memory summary.
   - Update: Purge remaining references to dam-hopper-plugin-runner or external plugin runtimes; document native Rust advisor subsystem and React panel.
5. **Fresh-State Reset V2**:
   - Evidence: packages/ui/src/lib/fresh-state-reset.ts.
   - Update: Document legacy key eviction list and upgrade marker dam-hopper:fresh-reset-v2-applied.

---

## 6. Retired vs. Active Functionality

| Feature / Artifact | Status | Source Evidence |
| :--- | :--- | :--- |
| packages/ui/src/index.ts | Retired / Non-existent | Replaced by packages/ui/src/embed/dam-hopper-app.tsx and explicit package exports. |
| Plugin Runner (dam-hopper-plugin-runner) | Retired | Advisor is now native Rust server subsystem + React panel (packages/ui/src/advisor/). |
| Legacy WS {type: "..."} envelope | Retired | Replaced by {kind: "..."} in packages/ui/src/api/ws-transport.ts. |
| Unowned dam-hopper:active-project | Retired | Cleaned up by workspace.ts and fresh-state-reset.ts; replaced by selectedProject: ProjectRef. |
| dam-hopper:terminal-pins:v1 | Retired | Discarded by fresh-state-reset.ts; replaced by target-scoped pin persistence. |
| Multi-profile Workbench | Active | packages/ui/src/api/connections.ts, ownership.ts. |
| Native Advisor Policy CAS & Introspection | Active | packages/ui/src/advisor/, packages/ui/src/hooks/use-advisor.ts. |
| Leased Git Push & Squash | Active | packages/ui/src/hooks/use-leased-git-push.ts, use-git-squash.ts. |
| Cognito Privacy Mode | Active | packages/ui/src/hooks/use-cognito-mode-input-guard.ts, stores/cognito-mode.ts. |
| AES-256-GCM OPAQUE Encrypted Upload | Active | packages/ui/src/lib/crypto.ts, contexts/EncryptContext.tsx. |
| Browser Bridge & Element Picker | Active | packages/browser-bridge/src/protocol.ts, picker.ts. |

---

## 7. Unresolved Questions
1. Does any external consumer depend on importing @dam-hopper/ui without subpaths, and should a top-level packages/ui/src/index.ts re-export file be created to prevent resolution errors in third-party tooling?
2. Are mobile native hosts planning to support multi-profile remote connections, or will they remain strictly constrained to same-origin loopback as asserted in server-config.ts?
