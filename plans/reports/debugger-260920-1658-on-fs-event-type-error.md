# Investigation Report: TypeError: h.onFsEvent is not a function in FileTree

- **Target Error**: `TypeError: h.onFsEvent is not a function at FileTree-BsddHsHS.js:26:1909`
- **Context**: 2 profiles configured (Profile 1 connected/active in Terminal mode; Profile 2 disconnected). Triggered upon pressing `Ctrl+Shift+E` (open Explorer panel in Terminal mode) or switching to IDE mode, even when project folder has no files.
- **Investigation Date**: 2026-09-20
- **Scope**: Investigation and diagnosis only. No source code modifications.

---

## 1. Executive Summary

### Issue Description & Business Impact
When multiple server profiles exist and one profile is disconnected (Profile 2) while another profile is connected and actively used (Profile 1), attempting to open the Explorer file panel (via `Ctrl+Shift+E` in Terminal mode, or switching to IDE mode) throws an unhandled `TypeError: h.onFsEvent is not a function` inside `<FileTree>`.

Because `<FileTree>` is suspended under `<WorkspacePage>` without an isolated local `<ErrorBoundary>`, the uncaught exception bubbles to the root `<WorkspacePage>` error boundary (`packages/ui/src/embed/dam-hopper-app.tsx:360`). This crashes the entire workspace view, unmounting active terminals and interrupting ongoing user workflows.

### Root Cause Identification
Two interlocking architectural defects combine to trigger this failure:

1. **Stateful Subscription Cached with `staleTime: Infinity` + Ephemeral Hook Ref (`use-fs-subscription.ts:97, 102-155`)**:
   - `useFsSubscription` stores the active WebSocket transport in an ephemeral component ref: `const originatingTransportRef = useRef<WsTransport | null>(null)`.
   - The tree query (`treeQueryKey = ["fs-tree", profileId, project, targetKey, path]`) uses `staleTime: Infinity`.
   - When `<FileTree>` unmounts (closing Explorer panel or switching out of IDE mode), `useEffect` cleanup destroys the server-side watch via `t.fsUnsubscribeTree(subId)`. However, TanStack Query retains `{ sub_id, nodes }` in memory.
   - When `<FileTree>` remounts (`Ctrl+Shift+E` opens `TerminalFloatingFilePanel`), `useQuery` immediately returns cached data. `queryFn` **does not execute**.
   - `originatingTransportRef.current` remains `null`.
   - `useEffect` falls back via `const t = originatingTransportRef.current ?? (getTransport() as WsTransport);`.
   - `useEffect` **never** attempts to capture the connection for `targetRef.profileId` (unlike `queryFn`). It blindly falls back to global singleton `getTransport()`.

2. **Global Transport Clobbered by Disconnected Secondary Profile (`connections.ts:492-495`)**:
   - In `disconnectProfile(profileId)`:
     ```ts
     const activeId = getActiveProfileId();
     if (!activeId || activeId === profileId) {
       reconfigureTransport(new IdleTransport());
     }
     ```
   - In multi-profile setups, `getActiveProfileId()` in `server-config.ts` points to the most recently created or selected profile in settings (Profile 2), or returns `null` if unassigned. Working in Terminal mode on a Profile 1 project updates `useWorkspaceStore.selectedProject`, but **never** updates `KEY_ACTIVE_PROFILE` in `server-config.ts`.
   - When Profile 2 disconnects or fails initial connection, `activeId === profileId` (or `!activeId`) evaluates to `true`.
   - `connections.ts` executes `reconfigureTransport(new IdleTransport())`, clobbering the global singleton `_transport` with `IdleTransport`.
   - `IdleTransport` implements `Transport` but leaves all FS methods (`onFsEvent`, `fsSubscribeTree`, `fsUnsubscribeTree`) `undefined`.
   - `use-fs-subscription.ts:153` unsafely casts `getTransport() as WsTransport` and calls `t.onFsEvent(subId, ...)`. Since `IdleTransport.onFsEvent` is `undefined`, it crashes with `TypeError: h.onFsEvent is not a function`.

### Why It Happens "Even When No Files Are in Explorer"
The backend RPC `fs:subscribe_tree` always provisions a directory watcher for directory `""` (project root). Regardless of whether directory contains 0 or 10,000 files, the backend returns `{ sub_id: N, nodes: [] }`. `subId` is always non-null. Therefore, `useFsSubscription` always proceeds past `if (subId == null) return;` and attempts to bind `t.onFsEvent(subId, ...)`.

---

## 2. Technical Analysis

### 2.1 Minified Call Stack De-Anonymization

| Minified Symbol | Production Bundle Location | Source File & Line | Real Source Identifier |
| :--- | :--- | :--- | :--- |
| `FileTree-BsddHsHS.js` | Chunk for `FileTree` organism | `packages/ui/src/components/organisms/FileTree.tsx:357` | Hook invocation `useFsSubscription(requestTarget, path)` |
| `h` | `FileTree-BsddHsHS.js:26:1909` | `packages/ui/src/hooks/use-fs-subscription.ts:153` | Variable `t` (`originatingTransportRef.current ?? (getTransport() as WsTransport)`) |
| `h.onFsEvent` | `FileTree-BsddHsHS.js:26:1909` | `packages/ui/src/hooks/use-fs-subscription.ts:155` | `t.onFsEvent(subId, (ev: FsEventDto) => { ... })` |

### 2.2 Component Hierarchy & Mount Transitions

```
DamHopperApp (packages/ui/src/embed/dam-hopper-app.tsx:360)
 └─ <ErrorBoundary>
     └─ <WorkspacePage> (packages/ui/src/components/pages/WorkspacePage.tsx)
         ├─ Terminal mode:
         │   └─ <TerminalWorkspaceShell>
         │       └─ terminalOverlayContent -> <TerminalFloatingFilePanel open={terminalFilePanelOpen}>
         │           └─ if (!open) return null (packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx:65)
         │           └─ if (open): mounts <FileTree>
         │               └─ useFsSubscription(requestTarget, "")
         └─ IDE mode:
             └─ <IdeShell>
                 └─ leftTools (Explorer tool active by default: packages/ui/src/components/pages/WorkspacePage.tsx:1990)
                     └─ mounts <FileTree>
                         └─ useFsSubscription(requestTarget, "")
```

### 2.3 Detailed Step-by-Step Execution Failure

1. **Bootstrap Phase**:
   - `apps/web/src/main.tsx:35`: `initTransport(new IdleTransport())` initializes ambient transport.
   - Dam Hopper default workspace mode is `"ide"` (`packages/ui/src/lib/workspace-mode.ts:28-29`).
   - App mounts in IDE mode; `<FileTree>` mounts for Profile 1's project.
   - `useFsSubscription` executes `queryFn`:
     ```ts
     const conn = captureConnection(targetRef.profileId);
     t = getConnectionsTransport(conn) as WsTransport;
     originatingTransportRef.current = t;
     const result = await t.fsSubscribeTree(requestTarget, path); // returns { sub_id: 1, nodes: [...] }
     ```
   - Query client caches `["fs-tree", "profile-1", "project-A", "root", ""]` with `sub_id: 1` and `staleTime: Infinity`.
   - `useEffect` binds `t.onFsEvent(1, ...)`.

2. **Switch to Terminal Mode**:
   - User switches `workspaceMode` to `"terminal"`.
   - `<IdeShell>` unmounts; `<FileTree>` unmounts.
   - `use-fs-subscription.ts:176-179` cleanup runs:
     ```ts
     off();
     t.fsUnsubscribeTree(subId); // backend tears down watch sub_id: 1
     ```
   - Ephemeral ref `originatingTransportRef` is garbage collected.
   - TanStack Query cache **retains** `{ sub_id: 1, nodes: [...] }`.

3. **Profile 2 Disconnects / Drops**:
   - Profile 2 (configured in settings, marked active profile in `server-config.ts` or `activeId` null) drops or disconnects.
   - `packages/ui/src/api/connections.ts:476-500` executes `disconnectProfile(profile2)`:
     ```ts
     const activeId = getActiveProfileId();
     if (!activeId || activeId === profileId) {
       reconfigureTransport(new IdleTransport());
     }
     ```
   - Global singleton `_transport` is set to `new IdleTransport()`.
   - Global `_transportGeneration` increments.
   - **Crucial note**: Profile 1's connection entry in `connections.ts` `entries.get("profile-1")` remains healthy and connected with its own `WsTransport`. Only global `_transport` is corrupted.

4. **User Presses `Ctrl+Shift+E` (or Opens IDE Mode)**:
   - `setTerminalFilePanelOpen(true)` flips `terminalFilePanelOpen` to `true`.
   - `<TerminalFloatingFilePanel>` renders `<FileTree>`: mounts for the first time in terminal panel.
   - In `useFsSubscription`:
     - Line 95: `const transportGeneration = useTransportGeneration();` (reads current global generation).
     - Line 96: `const boundTransportGenerationRef = useRef(transportGeneration);` (initialized to current generation).
     - Line 97: `const originatingTransportRef = useRef<WsTransport | null>(null);` (initialized to `null`).
     - Line 102: `useQuery` checks cache for `["fs-tree", "profile-1", "project-A", "root", ""]`. Cache hit! StaleTime is Infinity.
     - `queryFn` **does NOT run**. `originatingTransportRef.current` remains `null`.
     - Line 141: `subId = query.data?.sub_id` evaluates to `1`.
     - Line 144: `boundTransportGenerationRef.current !== transportGeneration` is `false` (both initialized to same current generation on mount). Query reset is skipped.
     - Line 152:
       ```ts
       const t = originatingTransportRef.current ?? (getTransport() as WsTransport);
       ```
       Since `originatingTransportRef.current === null`, `t` becomes `getTransport()` (`IdleTransport`).
     - Line 155:
       ```ts
       const off = t.onFsEvent(subId, (ev: FsEventDto) => { ... });
       ```
       `IdleTransport.onFsEvent` is `undefined`.
       **Crash**: `TypeError: h.onFsEvent is not a function at FileTree-BsddHsHS.js:26:1909`.

---

## 3. Detailed Root Causes & Flaw Matrix

| Component | File & Line | Architectural Flaw | Impact |
| :--- | :--- | :--- | :--- |
| `useFsSubscription` | `packages/ui/src/hooks/use-fs-subscription.ts:152-154` | Hook `useEffect` does not resolve connection from `targetRef.profileId`. Only checks `originatingTransportRef.current ?? getTransport()`. | Bypasses connected profile's valid `WsTransport` and falls back to ambient singleton. |
| `useFsSubscription` | `packages/ui/src/hooks/use-fs-subscription.ts:97, 137` | Server watch `sub_id` stored in TanStack Query with `staleTime: Infinity` while underlying WS subscription is destroyed on unmount. | Stale subscription ID re-used on remount without re-subscribing; bypasses `queryFn` where transport ref was assigned. |
| `useFsSubscription` | `packages/ui/src/hooks/use-fs-subscription.ts:153-155` | Unchecked type assertion `getTransport() as WsTransport` and missing `typeof t.onFsEvent === "function"` guard. | Calling optional/undefined transport methods throws uncaught runtime exception. |
| `useFsSubscription` | `packages/ui/src/hooks/use-fs-subscription.ts:95` | `useTransportGeneration()` invoked without `targetRef.profileId`. | Subscribes to ambient transport changes rather than profile connection changes; misses connection-specific state shifts. |
| `connections.ts` | `packages/ui/src/api/connections.ts:492-495` | `disconnectProfile` sets global transport to `IdleTransport` whenever `!activeId \|\| activeId === profileId`. | Secondary profile disconnection destroys ambient transport for primary connected profile. |
| `IdleTransport` | `packages/ui/src/api/idle-transport.ts:9-51` | FS methods (`onFsEvent`, `fsSubscribeTree`, `fsUnsubscribeTree`) are completely omitted instead of safe no-op fallbacks. | Any ambient transport fallback immediately throws `is not a function`. |
| `WorkspacePage` / `FileTree` | `packages/ui/src/components/pages/WorkspacePage.tsx:2314, 2484` | No `<ErrorBoundary>` enclosing `<FileTree>` inside floating terminal panel or IDE sidebar. | Local tree crash crashes entire user workspace including active PTY terminals. |

---

## 4. Supporting Evidence & Code Comparisons

### 4.1 Contrast: Defensive Transport Handling in `client.ts` vs Unsafe in `use-fs-subscription.ts`

In `packages/ui/src/api/client.ts:2503-2509`, transport methods are defensively guarded:
```ts
// packages/ui/src/api/client.ts
onEvent: (sub_id: number, cb: (event: FsEventDto) => void) => {
  const fsTrans = transport as unknown as FsTransportSeam;
  if (typeof fsTrans.onFsEvent === "function") {
    return fsTrans.onFsEvent(sub_id, cb) as () => void;
  }
  return transport.onEvent(`fs:${sub_id}`, (payload) => cb(payload as FsEventDto));
}
```

In `packages/ui/src/api/client.ts:2845`, ambient default transport uses optional chaining:
```ts
onFsEvent: (...args: unknown[]) => (getTransport() as unknown as FsTransportSeam).onFsEvent?.(...args),
```

In contrast, `packages/ui/src/hooks/use-fs-subscription.ts:153-155` has zero guards:
```ts
// packages/ui/src/hooks/use-fs-subscription.ts
const t =
  originatingTransportRef.current ?? (getTransport() as WsTransport); // UNSAFE CAST
const workspaceEpoch = explorerLanguageScanWorkspaceEpoch(qc, targetRef);
const off = t.onFsEvent(subId, (ev: FsEventDto) => { ... }); // UNGUARDED CALL -> CRASH
```

### 4.2 Why Existing Tests Failed to Catch This
1. `packages/ui/src/hooks/use-fs-subscription.test.tsx:61-65`:
   `getTransport` is mocked to always return `{ onFsEvent: vi.fn(), fsSubscribeTree: vi.fn(), fsUnsubscribeTree: vi.fn() }`.
2. `packages/ui/src/hooks/use-fs-subscription.test.tsx:41-59`:
   `useQuery` is mocked with a static stub that never runs `queryFn`, never tests cache staleness/remounts, and never uses real `IdleTransport`.
3. `packages/ui/src/api/connections.test.ts`:
   Tests terminal writes and profile drops, but does not assert behavior of FS subscriptions or ambient transport status when multi-profile disconnects occur.

---

## 5. Actionable Recommendations

### Priority 1: Immediate Fixes (Critical)

1. **Resolve Profile-Scoped Transport in Hook `useEffect` & `loadChildren`**:
   In `packages/ui/src/hooks/use-fs-subscription.ts`:
   Create a helper function to resolve transport identically in `queryFn`, `useEffect`, and `loadChildren`:
   ```ts
   function resolveTransport(): WsTransport | Transport {
     if (originatingTransportRef.current) return originatingTransportRef.current;
     if (targetRef.profileId) {
       try {
         const conn = captureConnection(targetRef.profileId);
         return getConnectionsTransport(conn);
       } catch {
         // fallback
       }
     }
     return getTransport();
   }
   ```

2. **Defensive Function Guard for `onFsEvent`**:
   In `packages/ui/src/hooks/use-fs-subscription.ts:155`:
   ```ts
   const t = resolveTransport();
   if (typeof (t as any).onFsEvent !== "function") {
     // Safe no-op or fallback to t.onEvent(`fs:${subId}`, ...)
     return;
   }
   ```

3. **Prevent Stale `subId` Reuse on Remount**:
   In `packages/ui/src/hooks/use-fs-subscription.ts`:
   Because `sub_id` represents an active, stateful backend subscription that is explicitly destroyed on unmount (`t.fsUnsubscribeTree(subId)` at line 178), `sub_id` should not be preserved as indefinitely valid across unmounts without re-subscribing.
   Either:
   - Reset the query on unmount or set `staleTime: 0` / short staleTime for the subscription query so remounting triggers a fresh `fsSubscribeTree`.
   - Or separate node tree data (cached) from active subscription handle (component lifecycle bound).

4. **Fix Ambient Transport Demotion in `connections.ts`**:
   In `packages/ui/src/api/connections.ts:492-495`:
   When Profile 2 disconnects, do not demote `_transport` to `IdleTransport` if another profile (Profile 1) is currently connected and active. Only demote to `IdleTransport` if no profile remains connected or if the disconnected profile was truly the sole active connection.

5. **Implement Safe No-Ops on `IdleTransport`**:
   In `packages/ui/src/api/idle-transport.ts`:
   Add no-op implementations for `onFsEvent`, `fsSubscribeTree`, `fsUnsubscribeTree`, and `fsOp`:
   ```ts
   onFsEvent(): () => void {
     return () => {};
   }
   fsSubscribeTree(): Promise<{ sub_id: number; nodes: [] }> {
     return Promise.reject(new Error("Server profile required"));
   }
   fsUnsubscribeTree(): void {}
   ```

### Priority 2: Resilience & Isolation (High)

1. **Contain Component Crashes with Local Error Boundaries**:
   Wrap `<FileTree>` inside `<TerminalFloatingFilePanel>` and `<IdeShell>` with a localized `<ErrorBoundary fallback={<FileTreeErrorFallback />}>` so an Explorer crash never takes down the entire `WorkspacePage` or active terminal sessions.

2. **Pass Profile ID to `useTransportGeneration`**:
   In `packages/ui/src/hooks/use-fs-subscription.ts:95`:
   Change:
   ```ts
   const transportGeneration = useTransportGeneration(targetRef.profileId);
   ```
   Ensures the hook tracks changes to Profile 1's connection generation rather than global ambient generation.

---

## 6. Unresolved Questions

1. *Should `setActiveProfile` in `server-config.ts` automatically track the profile of `selectedProject` in `useWorkspaceStore`?*
   Currently, switching projects across profiles in Terminal mode leaves `damhopper_active_profile_id` in localStorage untouched. Clarifying whether active profile is a global host concept or workspace-project-driven concept will avoid future transport sync desynchronizations.
2. *Should TanStack Query store `sub_id` at all?*
   Since `sub_id` is an ephemeral server session token that is invalidated upon unmount or socket reconnection, storing it alongside static directory tree nodes in `useQuery` creates tension between static cache semantics and active connection semantics. Separating tree node caching from WebSocket subscription management would eliminate this class of bug entirely.
