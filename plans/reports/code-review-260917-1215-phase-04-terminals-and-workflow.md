# Code Review: Phase 04 — Terminals and Workflow in Unified Multi-Profile Workbench

## Code Review Summary

### Scope
- Files reviewed:
  - packages/ui/src/api/ownership.ts
  - packages/ui/src/lib/terminal-registry.ts
  - packages/ui/src/lib/terminal-incarnation-state.ts
  - packages/ui/src/lib/terminal-output-activity.ts
  - packages/ui/src/lib/terminal-mounted-sessions.ts
  - packages/ui/src/lib/terminal-auto-attach.ts
  - packages/ui/src/lib/terminal-pin-persistence.ts
  - packages/ui/src/lib/command-history.ts
  - packages/ui/src/types/terminal-layout.ts
  - packages/ui/src/lib/terminal-layout-tree.ts
  - packages/ui/src/hooks/use-terminal-layout.ts
  - packages/ui/src/lib/traditional-terminal-projects.ts
  - packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx
  - packages/ui/src/components/organisms/TerminalPanel.tsx
  - packages/ui/src/components/organisms/TerminalTabBar.tsx
  - packages/ui/src/components/organisms/MultiTerminalDisplay.tsx
  - packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx
  - packages/ui/src/hooks/use-terminal-manager.ts
  - packages/ui/src/hooks/use-terminal-tree.ts
  - packages/ui/src/api/queries.ts
  - packages/ui/src/api/workflow-queries.ts
  - packages/ui/src/lib/workflow-workspace-integration.ts
  - packages/ui/src/lib/terminal-notification-navigation.ts
  - packages/ui/src/lib/terminal-notification-signal-parser.ts
  - packages/ui/src/stores/terminal-notifications.ts
  - packages/ui/src/lib/diagnostics-client.ts
  - packages/ui/src/lib/diagnostics-export.ts
  - packages/ui/src/lib/fresh-state-reset.ts
  - packages/ui/src/components/pages/WorkspacePage.tsx
  - packages/ui/src/lib/terminal-continuity-unified-profile.test.ts
- Lines of code analyzed: ~5,200 LOC (+844 -293 git diff)
- Review focus: Phase 04 terminals, workflow, and owner navigation contracts
- Updated plans: `plans/260916-2137-unified-profile/phase-04-terminals-workflow-and-navigation.md`

### Overall Assessment
Score: **5.5/10**

Implementation achieves strong architecture foundations in workflow query scoping, diagnostics isolation, command history migration (v3 with legacy discard), and layout key encoding. Unit tests pass (170/170). However, critical integration flaws exist in runtime terminal registration and session isolation:
1. Terminal registry key mismatch breaks DOM attachment (`registerTerminal` keys by `["profileId","sessionId"]`, but consumers query by raw `sessionId`).
2. `TerminalPanel` passes raw `safeSessionId` to `registerTerminalOutputActivity`, causing state collision and activity suppression across profiles with identical session IDs.
3. `deriveTerminalAutoAttachState` matches tabs and mounted sessions by raw `sessionId` alone, hijacking cross-profile tabs when switching active profiles.

---

### Critical Issues

#### 1. Terminal Registry Key Mismatch Breaks DOM Element Attachment and Controls
- **Location**: `packages/ui/src/components/organisms/TerminalPanel.tsx:205-207, 408`, `packages/ui/src/components/organisms/PaneContainer.tsx:126, 137, 147-151, 160, 289, 299`, `packages/ui/src/lib/terminal-host-attachment.ts:36`, `packages/ui/src/lib/terminal-registry.ts:72-80`.
- **Cause**: In `TerminalPanel`, when `profileId` is present, `registerTerminal` stores entry under `terminalRegistrationKey = JSON.stringify([profileId, safeSessionId])` (e.g. `'["default","s1"]'`). But consuming components query `terminalRegistry` via raw string `safeSessionId` (`"s1"`). Because `terminalRegistry` is a raw JavaScript `Map`, `terminalRegistry.get("s1")` returns `undefined`. `getTerminal("s1")` also returns `undefined` because it only attempts exact matches on `"s1"`.
- **Impact**:
  - `attachTerminalsToHost` skips every terminal element; terminal is never mounted to DOM pane (blank panel).
  - Registry subscription in `PaneContainer` never triggers `doReparent()` for late-initializing terminals.
  - Keyboard handlers, zoom adjustments, and scroll buttons cannot find terminal instance.
- **Fix**:
  - In `terminal-registry.ts`, support lookup by raw `sessionId` fallback if exact key fails (matching `entry.terminalRef?.id === target`), or index by both qualified key and session reference.
  - In `PaneContainer.tsx`, resolve terminal entry via `getTerminal` using `session.terminalRef ?? sessionId` rather than direct `terminalRegistry.get(sessionId)` on raw map.

#### 2. Terminal Output Activity Collision Across Profiles
- **Location**: `packages/ui/src/components/organisms/TerminalPanel.tsx:346`, `packages/ui/src/lib/terminal-output-activity.ts:207-224`.
- **Cause**: Line 346 calls `registerTerminalOutputActivity(safeSessionId)` instead of `effectiveTerminalRef ?? safeSessionId`. When Profile A and Profile B have identical session IDs (`"shared-session"`), both register against key `"shared-session"`. Profile B overwrites `state.owner = Symbol(key)`. When Profile A outputs data, `if (state.owner === owner)` fails, silently dropping Profile A activity marks.
- **Impact**: Output activity indicators break for colliding sessions in multi-profile setups. Violates Gate 04A contract ("Colliding IDs never share state or cleanup").
- **Fix**: Change line 346 of `TerminalPanel.tsx` to:
  ```ts
  const outputActivity = registerTerminalOutputActivity(
    effectiveTerminalRef ?? safeSessionId,
  );
  ```

#### 3. Cross-Profile Tab Hijacking in `deriveTerminalAutoAttachState`
- **Location**: `packages/ui/src/lib/terminal-auto-attach.ts:153-228`.
- **Cause**: `existingTabIds` and `existingMountedIds` are populated with un-profiled `tab.sessionId`. When Profile B becomes active with an identical session ID:
  - An existing tab from Profile A (`tab.profileId: "profile-a"`) matches `sessionsById.get(tab.sessionId)`, overwriting Profile A tab's metadata/command with Profile B's session.
  - Profile B's live session is dropped from new tabs because `existingTabIds.has(session.id)` is true.
  - Profile A's mounted session similarly adopts Profile B's session.
- **Impact**: Direct state corruption between profiles during focus switch; Profile B terminals cannot be opened while Profile A has matching session ID.
- **Fix**: Key tab lookups and existence sets by qualified identity (`tupleKey(tab.profileId ?? profileId, tab.sessionId)`), matching sessions only within their respective `profileId`.

---

### High Priority Findings

#### 1. Unqualified Incarnation Tracking in TerminalPanel
- **Location**: `packages/ui/src/components/organisms/TerminalPanel.tsx:538-554, 726`.
- **Cause**: Lines 538, 550, and 726 pass raw `safeSessionId` and `session.id` to `latestTerminalSessionIncarnation` and `rememberTerminalSessionIncarnation`. Meanwhile, `useTerminalSessions` records incarnations qualified by `owner?.profileId`.
- **Impact**: `TerminalPanel` fails to observe current incarnation stored by `useTerminalSessions`, and exit events from colliding session IDs across profiles overwrite each other in `latestBySessionId`.
- **Fix**: Pass `effectiveTerminalRef ?? safeSessionId` to `latestTerminalSessionIncarnation` and `rememberTerminalSessionIncarnation`.

#### 2. `useTransportGeneration()` in `TerminalPanel` Does Not Observe Profile Reconnection
- **Location**: `packages/ui/src/components/organisms/TerminalPanel.tsx:165`.
- **Cause**: Invokes `useTransportGeneration()` without passing `profileId`.
- **Impact**: `useTransportGeneration` supports `profileId`. Without it, the hook only tracks global active transport. When a background profile reconnects, its kept-alive terminal panel does not re-render or rebind subscriptions.
- **Fix**: Change line 165 to:
  ```ts
  const transportGeneration = useTransportGeneration(profileId);
  ```

#### 3. Direct Map Access on `terminalRegistry`
- **Location**: `packages/ui/src/components/organisms/PaneContainer.tsx:126, 137, 160, 196, 218, 289, 299, 324`, `TerminalRuntimeOutput.tsx:81, 92, 112`, `TerminalScrollButtons.tsx:164, 213`.
- **Cause**: Exporting `terminalRegistry` as a raw `Map` allows callers to bypass helper encapsulation (`getTerminal`, `hasTerminal`, `removeTerminal`).
- **Impact**: Prevents unified key resolution and profile fallback.

---

### Medium Priority Improvements

1. **TerminalActivityIndicator Missing Profile Qualification**:
   - `TerminalActivityIndicator.tsx` accepts only `sessionId` string. Should accept `target: TerminalRef | string` or `profileId` so activity queries match qualified activity entries.
2. **Terminal Panel Font Zoom Re-fit Lookup**:
   - `TerminalPanel.tsx:901, 962` uses `terminalRegistry.get(safeSessionId)` which evaluates to `undefined` when registered with qualified key. Replace with `terminalEntry` captured in closure or `getTerminal(terminalRegistrationKey)`.

---

### Low Priority Suggestions

1. **Clean up redundant type assertions**: In `workflow-queries.ts:110-112`, explicit type assertion can be replaced with standard TypeScript type guard.
2. **Normalize tab label fallback**: In `terminal-auto-attach.ts:77`, safe fallback for empty command split can use `session.command || "terminal"`.

---

### Positive Observations

1. **Clean Storage Version Migration**: `command-history.ts` properly bumped to version 3, implementing profile salting and discarding legacy unversioned entries cleanly per G0 specifications.
2. **Thorough Workflow Queries Scoping**: `workflow-queries.ts` comprehensively updated. Every mutation and query is properly wrapped with `resolveWorkflowOwner(options)` and invalidates profile-scoped query keys.
3. **Diagnostics Export Redaction & Isolation**: Correctly scopes exports to `options.profileId`, excludes cross-profile metadata, and completely omits command history from export bundles.
4. **Authoritative Incarnation Navigation**: `resolveWorkflowTerminalReveal` correctly verifies authoritative incarnation and rejects navigation on mismatch with clear reason codes (`profile_mismatch`, `incarnation_mismatch`).
5. **Clean Unmount Detach Semantics**: `TerminalPanel` unmount unsubscribes event handlers and disposes local addons without killing remote PTY processes.

---

### Recommended Actions

1. **Fix `terminal-registry.ts` and Consumers (Critical)**:
   - Update `getTerminal(target: TerminalRef | string)`: if `target` is a raw string and no direct match exists, find entry where `entry.terminalRef?.id === target`.
   - Update `PaneContainer.tsx` to use `getTerminal` instead of direct `terminalRegistry.get()`.
   - In `PaneContainer.tsx` registry subscription: check `node.sessionIds.includes(parseTerminalKey(registeredId)?.id ?? registeredId)`.
2. **Fix `TerminalPanel.tsx` Output Activity and Incarnation (Critical)**:
   - Line 346: pass `effectiveTerminalRef ?? safeSessionId` to `registerTerminalOutputActivity`.
   - Line 538, 550, 726: pass `effectiveTerminalRef ?? safeSessionId` to `latestTerminalSessionIncarnation` and `rememberTerminalSessionIncarnation`.
   - Line 165: pass `profileId` to `useTransportGeneration(profileId)`.
   - Line 901, 962: use `terminalRegistrationKey` or `getTerminal(terminalRegistrationKey)`.
3. **Fix `terminal-auto-attach.ts` Tab Matching (Critical)**:
   - Match existing tabs with sessions by compound key `[tab.profileId ?? profileId, tab.sessionId]`.
   - Populate `existingTabIds` and `existingMountedIds` as qualified keys so Profile B's identical session IDs are added as separate tabs.
4. **Update `TerminalActivityIndicator.tsx` (Medium)**:
   - Accept `profileId?: string` or `terminalRef?: TerminalRef` to query activity using qualified key.

---

### Metrics
- Type Coverage: 100% (Strict TypeScript in packages/ui)
- Test Coverage: 19 test files / 170 tests passing via Vitest (scoped Phase 04 run)
- Linting Issues: 0 critical linter errors

---

### Unresolved Questions
1. When multiple profiles have terminals with the same session ID in the same group view (e.g. Free Terminals), should `PaneContainer` display profile badges on the tab headers to distinguish them visually?
2. Should `terminalRegistry` raw Map export be deprecated in favor of an encapsulation object or helper methods only?
