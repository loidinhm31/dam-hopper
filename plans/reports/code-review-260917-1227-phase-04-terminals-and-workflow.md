# Code Review: Phase 04 — Terminals and Workflow (Cycle 2)

## Code Review Summary

### Scope
- Files reviewed:
  - `packages/ui/src/api/ownership.ts`
  - `packages/ui/src/lib/terminal-registry.ts`
  - `packages/ui/src/lib/terminal-incarnation-state.ts`
  - `packages/ui/src/lib/terminal-output-activity.ts`
  - `packages/ui/src/lib/terminal-mounted-sessions.ts`
  - `packages/ui/src/lib/terminal-auto-attach.ts`
  - `packages/ui/src/lib/terminal-pin-persistence.ts`
  - `packages/ui/src/lib/command-history.ts`
  - `packages/ui/src/types/terminal-layout.ts`
  - `packages/ui/src/lib/terminal-layout-tree.ts`
  - `packages/ui/src/hooks/use-terminal-layout.ts`
  - `packages/ui/src/lib/traditional-terminal-projects.ts`
  - `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx`
  - `packages/ui/src/components/organisms/TerminalPanel.tsx`
  - `packages/ui/src/components/organisms/TerminalTabBar.tsx`
  - `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`
  - `packages/ui/src/hooks/use-terminal-manager.ts`
  - `packages/ui/src/hooks/use-terminal-tree.ts`
  - `packages/ui/src/api/queries.ts`
  - `packages/ui/src/api/workflow-queries.ts`
  - `packages/ui/src/lib/workflow-workspace-integration.ts`
  - `packages/ui/src/lib/terminal-notification-navigation.ts`
  - `packages/ui/src/lib/terminal-notification-signal-parser.ts`
  - `packages/ui/src/stores/terminal-notifications.ts`
  - `packages/ui/src/lib/diagnostics-client.ts`
  - `packages/ui/src/lib/diagnostics-export.ts`
  - `packages/ui/src/lib/fresh-state-reset.ts`
  - `packages/ui/src/components/pages/WorkspacePage.tsx`
  - `packages/ui/src/lib/terminal-continuity-unified-profile.test.ts`
- Lines of code analyzed: ~5,300 LOC
- Review focus: Verification of dual-indexing, activity key scoping, auto-attach profile isolation, and transport generation fixes.
- Updated plans: `plans/260916-2137-unified-profile/phase-04-terminals-workflow-and-navigation.md`

---

### Overall Assessment
Score: **7.5/10**

Significant improvements across all core Gate 04 areas:
1. `TerminalPanel` now correctly scopes `transportGeneration = useTransportGeneration(profileId)`, enabling reconnect rebound on background profiles.
2. `TerminalPanel` registers and queries incarnation state via `terminalRegistrationKey` and `effectiveTerminalRef`.
3. `terminalRegistry` dual-indexing enables DOM attachment via `getTerminal` fallback.
4. `deriveTerminalAutoAttachState` preserves cross-profile open tabs without hijacking.
5. All 58 scoped Phase 04 unit tests pass; TypeScript typecheck emits zero errors.

However, three functional correctness blockers remain:
- `TerminalActivityIndicator` still only accepts raw `sessionId` string without profile context, leaving activity dots completely inert for all profiled terminals.
- `removeTerminal` in `terminal-registry.ts` deletes raw session IDs without checking entry ownership, causing unmounting in Profile B to break raw-ID lookups for Profile A.
- `nextMountedSessions` in `deriveTerminalAutoAttachState` lacks a cross-profile guard in its filter, dropping background-profile mounted sessions during auto-attach.

---

### Critical Issues

#### 1. `TerminalActivityIndicator` Consumes Raw `sessionId`, Breaking Activity Indicators for Profiled Terminals
- **Location**:
  - `packages/ui/src/components/atoms/TerminalActivityIndicator.tsx:86-108`
  - `packages/ui/src/components/organisms/TabBar.tsx:101-104`
  - `packages/ui/src/components/organisms/TerminalTabBar.tsx:104-107`
  - `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx:182-185`
- **Cause**: In `TerminalPanel.tsx:347`, output activity is registered under `terminalRegistrationKey` (`'["default","s1"]'`). But `TerminalActivityIndicator` accepts only `sessionId: string` and queries `subscribeToTerminalOutputActivity(sessionId)` and `getTerminalOutputActivitySnapshot(sessionId)`. Since `terminal-output-activity.ts` stores state strictly by string key, `sessions.get("s1")` returns an inert unnotified snapshot while `'["default","s1"]'` receives all marks.
- **Impact**: Output activity indicators in tabs and navigators never light up for any profiled terminal.
- **Fix**:
  1. Update `TerminalActivityIndicator` to accept `target: TerminalRef | string` or `profileId?: string`.
  2. In `TabBar.tsx`, `TerminalTabBar.tsx`, and `TerminalRuntimeNavigatorItem.tsx`, pass `profileId={tab.profileId}` or `target={tab.terminalRef ?? tab.sessionId}`.

#### 2. `removeTerminal` Prematurely Deletes Raw Session ID of Sibling Profile
- **Location**: `packages/ui/src/lib/terminal-registry.ts:96-109`
- **Cause**:
  ```ts
  if (entry?.terminalRef?.id) {
    deleted = terminalRegistry.delete(entry.terminalRef.id) || deleted;
  }
  ```
  When Profile A and Profile B both register session `"s1"`, Profile A sets `terminalRegistry.set("s1", entryA)`. Profile B does not overwrite `"s1"`. When Profile B unmounts, `removeTerminal` deletes `entryB.terminalRef.id` (`"s1"`).
- **Impact**: Deleting Profile B's terminal removes Profile A's raw-ID entry from `terminalRegistry`, breaking `getTerminal("s1")` and `PaneContainer` lookups while Profile A is still alive.
- **Fix**: Check that `terminalRegistry.get(entry.terminalRef.id) === entry` before deleting:
  ```ts
  if (entry?.terminalRef?.id && terminalRegistry.get(entry.terminalRef.id) === entry) {
    deleted = terminalRegistry.delete(entry.terminalRef.id) || deleted;
  }
  ```

#### 3. `nextMountedSessions` in `deriveTerminalAutoAttachState` Drops Cross-Profile Sessions
- **Location**: `packages/ui/src/lib/terminal-auto-attach.ts:220-228`
- **Cause**:
  ```ts
  const nextMountedSessions = [
    ...mountedSessions.filter(
      (mounted) =>
        !ignoredSessionIds.has(mounted.sessionId) &&
        (liveById.has(mounted.sessionId) ||
          pendingSessionIds.has(mounted.sessionId) ||
          !knownSessionIds.has(mounted.sessionId) ||
          existingTabIds.has(mounted.sessionId)),
    )...
  ```
  `existingTabIds` was scoped to only include tabs matching the current `profileId`. For a mounted session belonging to another profile (`mounted.profileId !== profileId`), if its `sessionId` happens to match a session in `knownSessionIds` of the current profile (e.g. a dead or stopped session), none of `liveById`, `pendingSessionIds`, `!knownSessionIds`, or `existingTabIds` will be true.
- **Impact**: Background profile mounted sessions get silently discarded on active profile switch.
- **Fix**: Add a bypass for other profiles in the filter:
  ```ts
  (profileId && mounted.profileId && mounted.profileId !== profileId) ||
  ```

---

### Warnings (High Priority)

#### 1. `PaneContainer.tsx` Registry Listener Does Not Match Serialized Tuple Key
- **Location**: `packages/ui/src/components/organisms/PaneContainer.tsx:147-151`
- **Cause**: `registerTerminal` calls `notifyRegistryChange(key)` with `key = '["profile","sessionId"]'`. `PaneContainer` subscribes via:
  ```ts
  if (node.sessionIds.includes(registeredId)) { doReparent(); }
  ```
  Since `node.sessionIds` contains raw session IDs like `"s1"`, `node.sessionIds.includes('["profile","s1"]')` returns `false`.
- **Impact**: If a terminal initializes late (after initial `PaneContainer` mount), `doReparent()` is not triggered automatically.
- **Fix**: Normalize `registeredId` via `parseTerminalKey(registeredId)?.id ?? registeredId`.

#### 2. Direct Map Access `terminalRegistry.get(sessionId)` in UI Organisms
- **Location**: `packages/ui/src/components/organisms/PaneContainer.tsx:126, 137, 160`, `TerminalRuntimeOutput.tsx:81, 92, 112`
- **Cause**: Accessing `terminalRegistry.get(sessionId)` directly on the raw Map bypasses `getTerminal(sessionId)` fallback logic.
- **Impact**: If dual-indexed raw keys collide or are cleaned up, the component fails to find the terminal instance.
- **Fix**: Replace all direct `terminalRegistry.get(...)` calls with `getTerminal(...)`.

#### 3. `handleSessionExit` in `use-terminal-manager.ts` Lacks Profile Qualification
- **Location**: `packages/ui/src/hooks/use-terminal-manager.ts:1508-1528`
- **Cause**: `handleSessionExit(sessionId: string)` does not receive `profileId` or `terminalRef`. It calls `setOpenTabs` and unpins all tabs matching `tab.sessionId === sessionId` regardless of `tab.profileId`.
- **Impact**: When session `"s1"` exits on Profile A, Profile B's `"s1"` is unpinned and marked stopped in `locallyStoppedSessionMarkersRef`.
- **Fix**: Update `handleSessionExit` to accept `target: TerminalRef | string` or `(sessionId: string, profileId?: string)` and qualify unpinning/marker sets.

#### 4. Terminal Pin Persistence (`terminal-pin-persistence.ts`) is Unpartitioned
- **Location**: `packages/ui/src/lib/terminal-pin-persistence.ts:1, 43, 66`
- **Cause**: `TERMINAL_PIN_STORAGE_KEY = "dam-hopper:terminal-pins:v2"` stores raw string IDs without profile keys.
- **Impact**: Pinned terminal IDs are shared across profiles in sessionStorage.

---

### Suggestions (Medium / Low Priority)

1. **Clean up redundant type assertions**: In `workflow-queries.ts:111-113`, `ownerOrOptions as { owner?: ConnectionRef; profileId?: ProfileId }` can be replaced with a small type guard.
2. **Tab label fallback**: In `terminal-auto-attach.ts:76-78`, `session.command.split(/[\s/\\]/).find(Boolean) ?? session.command` can be simplified with `session.command || "terminal"`.

---

### Positive Observations

1. **Transport Generation Reattachment**: `useTransportGeneration(profileId)` in `TerminalPanel.tsx` ensures connection drops and reconnects rebind terminal panel event listeners reliably.
2. **Authoritative Incarnation Qualification**: `TerminalPanel.tsx` consistently passes `terminalRegistrationKey` to incarnation state helpers, guarding against stale process exit races.
3. **Robust Command History (v3)**: Clean version bump, salt hashing by profile ID, and strict legacy unversioned entry discard without data corruption.
4. **Diagnostics Export Isolation**: Strict scoping by `targetProfileId`, server tail redaction, and complete omission of command history.
5. **Clean Unmount Detach Semantics**: Terminal unmount disposes UI addons and xterm instances while keeping backend PTYs intact.

---

### Validation Commands and Results

1. Targeted Phase 04 continuity test suite:
   ```bash
   pnpm --filter @dam-hopper/ui test src/lib/terminal-continuity-unified-profile.test.ts
   ```
   **Result**: 1 passed, 9 tests passed (239ms).

2. Scoped Phase 04 regression suite:
   ```bash
   pnpm --filter @dam-hopper/ui test src/lib/terminal-auto-attach.test.ts src/lib/terminal-registry.test.ts src/lib/terminal-pin-persistence.test.ts src/lib/command-history.test.ts src/lib/traditional-terminal-projects.test.ts src/lib/terminal-continuity-unified-profile.test.ts
   ```
   **Result**: 6 passed, 58 tests passed (261ms).

3. Type checking:
   ```bash
   pnpm --filter @dam-hopper/ui exec tsc --noEmit
   ```
   **Result**: 0 errors (clean compilation).

---

### Recommended Actions (Prioritized)

1. **Fix `terminal-registry.ts` Deletion Check (Critical)**:
   In `removeTerminal`, only delete `entry.terminalRef.id` if `terminalRegistry.get(entry.terminalRef.id) === entry`.
2. **Fix `TerminalActivityIndicator.tsx` Scoping (Critical)**:
   Accept `profileId?: string` or `target?: TerminalRef | string` and pass `tab.profileId`/`session.profileId` from `TabBar`, `TerminalTabBar`, and `TerminalRuntimeNavigatorItem`.
3. **Fix `deriveTerminalAutoAttachState` Mounted Filter (Critical)**:
   Add `(profileId && mounted.profileId && mounted.profileId !== profileId)` to the preservation predicate in `nextMountedSessions`.
4. **Fix `PaneContainer.tsx` Subscription Parsing (High)**:
   Parse `registeredId` via `parseTerminalKey` before checking `node.sessionIds.includes(...)`.
5. **Replace Direct Map Lookups with `getTerminal` (High)**:
   Replace direct `terminalRegistry.get(...)` calls with `getTerminal(...)`.
6. **Qualify `handleSessionExit` by Profile (High)**:
   Pass `session.profileId` to `onSessionExit` and qualify unpinning logic in `useTerminalManager`.

---

### Unresolved Questions
1. Should `terminalRegistry` raw `Map` export be unexported or wrapped in a readonly accessor to prevent future direct map bypasses?
2. Should terminal pin persistence (`terminal-pin-persistence.ts`) migrate to a v3 schema keyed by `[profileId, sessionId]` or use profile-scoped storage keys?
