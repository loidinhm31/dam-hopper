# Code Review: Phase 04 — Terminals and Workflow (Cycle 3)

## Code Review Summary

### Scope
- Files reviewed (34 files):
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
  - `packages/ui/src/components/organisms/PaneContainer.tsx`
  - `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx`
  - `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`
  - `packages/ui/src/components/atoms/TerminalActivityIndicator.tsx`
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
- Lines of code analyzed: ~5,600 LOC (+994 -360 git diff)
- Review focus: Verification of activity indicator scoping, raw ID ownership in `removeTerminal`, cross-profile mounted session preservation, pin partitioning, security, performance, architecture, YAGNI/KISS/DRY.
- Updated plans: `plans/260916-2137-unified-profile/phase-04-terminals-workflow-and-navigation.md`

### Overall Assessment
Score: **8.8/10**

Remediation in Cycle 3 successfully resolved all 3 previous functional blockers:
1. Activity indicator now accepts `profileId` and `terminalRef`, properly querying qualified output activity snapshots.
2. `removeTerminal` checks raw entry ownership (`rawEntry === entry`) before deleting raw ID entries, preventing unmounting in Profile B from dropping Profile A's raw ID alias.
3. `deriveTerminalAutoAttachState` mounted sessions filter now explicitly preserves cross-profile mounted sessions (`(profileId && mounted.profileId && mounted.profileId !== profileId)`).
4. Terminal pins partitioned into `v2` keys scoped by `profileId`, automatically purging legacy unpartitioned `v1` storage.

TypeScript typecheck passed with 0 errors. Scoped unit test suites passed (42/42 tests passing).

---

### Critical Issues
None. All previous blockers resolved.

---

### Warnings (High / Medium Priority)

#### 1. `TabBar.tsx` Missing `profileId` and `terminalRef` Props on `TerminalActivityIndicator`
- **Location**: `packages/ui/src/components/organisms/TabBar.tsx:101-104`
- **Cause**: While `TerminalTabBar.tsx:106-107` was updated to pass `profileId={tab.profileId}` and `terminalRef={tab.terminalRef}`, `TabBar.tsx` (the tab bar component used inside `PaneContainer.tsx` for split panes) was not updated:
  ```tsx
  <TerminalActivityIndicator
    sessionId={tab.sessionId}
    alive={tab.session?.alive}
  />
  ```
  `tab` in `TabBar.tsx` is of type `DisplayTabEntry` which carries `profileId` and `terminalRef`.
- **Impact**: In split-pane layouts, tab header activity indicators remain unnotified/dormant for profiled terminals because queries fall back to raw string `sessionId`, which does not match qualified activity map keys.
- **Fix**: Update `TabBar.tsx:101-104` to forward `profileId` and `terminalRef`:
  ```tsx
  <TerminalActivityIndicator
    sessionId={tab.sessionId}
    alive={tab.session?.alive}
    profileId={tab.profileId}
    terminalRef={tab.terminalRef}
  />
  ```

#### 2. `activateTerminalAfterNavigation` Does Not Match Qualified Session Key on Late Registration
- **Location**: `packages/ui/src/lib/terminal-notification-navigation.ts:138-142`
- **Cause**: In `activateTerminalAfterNavigation`:
  ```ts
  unsubscribe = subscribeToTerminal((registeredSessionId) => {
    if (registeredSessionId !== sessionId || !hasTerminal(sessionId)) return;
    activateTerminal(sessionId);
    dispose();
  });
  ```
  `registerTerminal` notifies subscribers with `toTerminalKey(target)`, which is `'["profileId","sessionId"]'`. `activateTerminalAfterNavigation` compares `registeredSessionId !== sessionId` directly against raw string `sessionId`.
- **Impact**: If navigation targets a profiled terminal that has not finished mounting, the late-registration event listener will never trigger activation because `'["profileId","sessionId"]' !== sessionId`. (Immediate activation at line 146 still works if terminal was already mounted).
- **Fix**: Match against both `registeredSessionId` and `entry?.terminalRef?.id`:
  ```ts
  unsubscribe = subscribeToTerminal((registeredSessionId) => {
    const entry = getTerminal(registeredSessionId);
    const rawId = entry?.terminalRef?.id ?? registeredSessionId;
    if ((registeredSessionId !== sessionId && rawId !== sessionId) || !hasTerminal(sessionId)) return;
    activateTerminal(sessionId);
    dispose();
  });
  ```

---

### Suggestions (Low Priority / Code Quality)

#### 1. Consume `profileId` in `WorkspacePage.tsx` Notification Selection
- **Location**: `packages/ui/src/components/pages/WorkspacePage.tsx:1165-1175`
- **Observation**: `subscribeToTerminalNotificationSelection` now passes `(sessionId, profileId, terminalRef)`. In `WorkspacePage.tsx`, the listener only binds `(sessionId)`. If a notification fires for a terminal belonging to a background profile, the workspace page should switch to `profileId` before revealing the terminal tab.

#### 2. Clean Up Qualified Key in `removeTerminal` When Called With Raw String
- **Location**: `packages/ui/src/lib/terminal-registry.ts:96-112`
- **Observation**: If `removeTerminal` is invoked with a raw string `sessionId`, it deletes `terminalRegistry.delete(target)` and `rawEntry`, but does not delete `toTerminalKey(entry.terminalRef)` if `entry?.terminalRef` exists. `TerminalPanel.tsx` correctly passes `terminalRegistrationKey`, but `removeTerminal` should defensively delete `terminalKey(entry.terminalRef)` when `entry?.terminalRef` is present.

#### 3. Replace Direct Map Access in `WorkspacePage.tsx:1200, 1203`
- **Location**: `packages/ui/src/components/pages/WorkspacePage.tsx:1200, 1203`
- **Observation**: Uses `terminalRegistry.has(candidateSessionId)` and `terminalRegistry.get(candidateSessionId)`. Use `hasTerminal(candidateSessionId)` and `getTerminal(candidateSessionId)` helpers instead to benefit from the linear-scan fallback.

---

### Positive Observations
1. **Robust Dual Indexing in Terminal Registry**: `terminalRegistry` dual indexes qualified ref keys and raw IDs, with full linear fallback in `getTerminal(target)`.
2. **Safe Deletion Check**: `removeTerminal` verifies `rawEntry === entry` before deleting raw IDs, preventing cross-profile alias destruction.
3. **Thorough Auto-Attach Cross-Profile Isolation**: `deriveTerminalAutoAttachState` protects background-profile tabs and mounted sessions from eviction or corruption.
4. **Partitioned Pin Storage**: Pin storage versioned to `v2` with `profileId` encoding; legacy unversioned/v1 storage automatically discarded.
5. **Scoped API and Transport Routing**: `TerminalPanel` and `useTerminalManager` resolve connection snapshots and execute calls via owner-bound instances (`getApi(snap.owner)` / `getConnectionTransport(snap.owner)`).

---

### Validation Commands and Results
1. `pnpm --filter @dam-hopper/ui test src/lib/terminal-continuity-unified-profile.test.ts`
   - **Result**: PASS (1 test file, 9/9 tests passed, duration: 254ms)
2. `pnpm --filter @dam-hopper/ui test src/lib/command-history.test.ts src/lib/terminal-pin-persistence.test.ts src/lib/traditional-terminal-projects.test.ts src/components/organisms/TerminalRuntimeOutput.test.tsx`
   - **Result**: PASS (4 test files, 33/33 tests passed, duration: 638ms)
3. `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`)
   - **Result**: PASS (Clean compilation, 0 type errors)

---

### Unresolved Questions
1. When a browser notification is clicked for a background profile's terminal, should `WorkspacePage` automatically invoke profile switching to that owner profile, or should it show a prompt/badge indicating cross-profile navigation?
2. Should `terminalRegistry` raw `Map` export be formally deprecated to ensure all consumers access entries via `getTerminal`/`hasTerminal`/`removeTerminal` helpers?
