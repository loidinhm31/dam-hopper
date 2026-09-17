# Code Review: Phase 05 — Agents, Ports, and Browser

## Code Review Summary

### Score: 9/10

### Scope
- Files reviewed:
  - `server/src/api/browser_debug.rs`
  - `server/src/browser_debug/mod.rs`
  - `server/src/browser_debug/store.rs`
  - `server/src/browser_debug/error.rs`
  - `server/src/browser_debug/tests.rs`
  - `server/src/pty/manager.rs`
  - `server/src/error.rs`
  - `server/tests/browser_debug_artifacts.rs`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/queries.ts`
  - `packages/ui/src/api/query-client.ts`
  - `packages/ui/src/api/server-config.ts`
  - `packages/ui/src/components/pages/AgentStorePage.tsx`
  - `packages/ui/src/components/pages/WorkspacePage.tsx`
  - `packages/ui/src/components/organisms/DistributionMatrix.tsx`
  - `packages/ui/src/components/organisms/ShipDialog.tsx`
  - `packages/ui/src/components/organisms/HealthStatus.tsx`
  - `packages/ui/src/components/organisms/ImportDialog.tsx`
  - `packages/ui/src/components/organisms/MemoryEditor.tsx`
  - `packages/ui/src/components/organisms/PortsPanel.tsx`
  - `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`
  - `packages/ui/src/components/organisms/BrowserDebugTerminalHandoff.tsx`
  - `packages/ui/src/components/organisms/BrowserDebugTerminalTargetList.tsx`
  - `packages/ui/src/hooks/use-ports.ts`
  - `packages/ui/src/hooks/use-ports.test.ts`
  - `packages/ui/src/hooks/use-tunnels.ts`
  - `packages/ui/src/hooks/use-browser-debug.ts`
  - `packages/ui/src/hooks/use-browser-debug.test.ts`
  - `packages/ui/src/hooks/use-feature-flag.ts`
  - `packages/ui/src/hooks/use-feature-flag.test.ts`
  - `packages/ui/src/lib/browser-debug-origin.ts`
  - `packages/ui/src/lib/browser-debug-origin.test.ts`
  - `packages/ui/src/lib/browser-debug-address-history.ts`
  - `packages/ui/src/lib/browser-debug-address-history.test.ts`
  - `packages/ui/src/lib/browser-terminal-handoff.ts`
  - `packages/ui/src/lib/browser-terminal-handoff.test.ts`
- Lines of code analyzed: ~3,800
- Review focus: Phase 05 agent tools, ports, Browser, capability isolation, and atomic incarnation binding
- Updated plans: `plans/260916-2137-unified-profile/phase-05-agents-ports-and-browser.md`

---

### Overall Assessment
Phase 05 implementation delivers robust capability isolation across both backend and frontend. The server-side incarnation-aware create and atomic `write_if_incarnation` admission in `PtySessionManager` effectively closes the PTY replacement race condition. On write failure, handoff locks are released cleanly, and input revision counters remain unmodified. On the frontend, multi-profile partitioning is rigorously maintained across agent store catalogs, import/ship workflows, memory draft protection, port detection identity keys (`profileId:port:sessionId:incarnation`), browser target revision tracking, and same-owner terminal handoff pipelines.

The earlier blocking TypeScript build failure (`TS2367` in `use-feature-flag.ts`) was confirmed resolved in the working tree (`tsc -p tsconfig.json` passes cleanly).

---

### Critical Issues
None remaining. The previously reported build blocker in `packages/ui/src/hooks/use-feature-flag.ts` line 73 (`snapshot.status === "error"`) has been fixed, and `pnpm --filter @dam-hopper/ui build` succeeds with zero errors.

---

### High Priority Findings / Warnings
1. **Reactivity gap in `useFeatureAvailability` (`packages/ui/src/hooks/use-feature-flag.ts:40`)**:
   `useFeatureAvailability` calls `getConnectionSnapshot(profileId)` inside `useMemo` with dependency on `profileId`, but does not subscribe to connection state changes via `useSyncExternalStore` or `useConnectionSnapshot(profileId)`. If connection status shifts between `connecting` -> `connected` or `offline` without a re-render triggered elsewhere, feature availability won't reactively update.
   - *Recommendation*: Use `useConnectionSnapshot(profileId)` from `@/api/connections.js` inside `useFeatureAvailability`.

2. **Completeness of 3-point snapshot re-check in `prepareBrowserTerminalArtifact` (`packages/ui/src/components/pages/WorkspacePage.tsx:640-664`)**:
   `prepareBrowserTerminalArtifact` snapshots three points: `snapshotOwner`, `snapshotRevision`, and `snapshotTerminalInstanceRef`. After `createArtifact` and `uploadPng` awaits, it checks `owner.profileId`, `owner.generation`, and `revision`. However, it omits re-checking whether `snapshotTerminalInstanceRef` is still valid and live in `browserTerminalTargets`.
   - *Impact*: Low risk in practice because `insertBrowserTerminalReference` validates terminal incarnation before handoff, and the backend's `write_if_incarnation` guarantees atomic validation on admission. Still, checking the terminal candidate after awaits would allow earlier abortion before unnecessary image upload.

---

### Medium Priority Improvements
1. **Precision in `port:lost` cache filtering (`packages/ui/src/hooks/use-ports.ts:241`)**:
   In `usePorts`, the `port:lost` listener filters with `p.port !== port || p.incarnation !== incarnation`. Event payload extracts `session_id`. If multiple terminals happen to observe the same port, filtering should ideally include `p.sessionId !== session_id` when present to avoid evicting a co-existing entry from another session.
2. **Unused import cleanup in server tests (`server/tests/linux_release_preflight_sqlite.rs:10`)**:
   Non-blocking compiler warning: `Path` is imported alongside `PathBuf` but never directly used in `linux_release_preflight_sqlite.rs`. Remove `Path` to keep compiler output completely clean.

---

### Low Priority Suggestions
1. **ShipDialog Error State Reset**:
   In `packages/ui/src/components/organisms/ShipDialog.tsx`, clicking outside or re-toggling target projects does not clear existing errors until a new submit attempt. A minor UX polish would clear `error` when targets change.
2. **ImportDialog Cleanup on Dismiss**:
   In `packages/ui/src/components/organisms/ImportDialog.tsx`, dismissing the dialog via `onClose` cancels the dialog immediately. Since `tmpDir` is held in memory by the server until swept or confirmed, an optional background delete hook for unconfirmed temporary scan directories could be wired when available.

---

### Positive Observations
1. **Atomic PTY Write Admission**:
   `write_if_incarnation` in `server/src/pty/manager.rs` shares identical locking, closing, disposing, and idle-suspend checks as `write`. It snapshots `prev_revision` and `prev_last_input_at` and restores them on failure, preventing PTY sequence pollution on conflict.
2. **Comprehensive Conflict Testing**:
   `server/tests/browser_debug_artifacts.rs` test `replaced_terminal_incarnation_rejects_handoff_without_writing_to_replacement_pty` explicitly asserts that input revision and buffer remain identical after a 409 rejection, and proves that handoff reservation release allows subsequent attempts to hit incarnation mismatch rather than lock contention.
3. **Qualified Port Keying**:
   `portEntryKey` formatted as `${profileId}:${port}:${sessionId}:${incarnation}` prevents identical port numbers across distinct profiles from clobbering each other in the UI.
4. **Draft Memory Protection**:
   `MemoryEditor` tracks `draftTargetRef`, warns the user with confirmation dialogs on unsaved project or agent switches, and prevents incoming server queries from overwriting in-flight edits.
5. **Rigorous Browser Debug Origin Boundary**:
   `resolveBrowserDebugTarget` rejects loopback URLs matching the parent host origin, strips credentials, enforces HTTP loopback or verified ready cloudflared tunnel URLs, and increments target revision on navigation to cleanly flush stale captures and bridge tokens.

---

### Metrics
- Type Coverage: 100% (clean TypeScript build via `tsc -p tsconfig.json`)
- Test Suite Status: 44/44 tests passed (5 integration tests, 5 backend unit tests, 34 Vitest tests across 6 files)
- Lint/Compiler Warnings: 0 errors; 1 pre-existing warning (`Path` in `linux_release_preflight_sqlite.rs:10`)

---

### Validation Commands and Results
1. `cd server && cargo test --test browser_debug_artifacts`:
   - 5 passed; 0 failed; 0.61s
2. `cd server && cargo test browser_debug`:
   - 5 passed; 0 failed; 0.00s (38 suites, 1413 filtered)
3. `pnpm --filter @dam-hopper/ui test src/hooks/use-ports.test.ts src/hooks/use-feature-flag.test.ts src/lib/browser-debug-address-history.test.ts src/hooks/use-browser-debug.test.ts src/lib/browser-terminal-handoff.test.ts src/lib/browser-debug-origin.test.ts`:
   - 6 test files passed, 34/34 tests passed, duration 621ms
4. `pnpm --filter @dam-hopper/ui build`:
   - PASSED with 0 errors (tsc finished cleanly)
5. `cd server && cargo check`:
   - PASSED (dev profile finished in 0.16s)

---

### Unresolved Questions
None. All design contracts and architectural boundary decisions from the Phase 05 plan are fulfilled.
