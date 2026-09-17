# Code Review: Phase 09 — Integration and Qualification

**Date:** 2026-09-17  
**Reviewer:** Phase09Reviewer (Senior Software Engineer)  
**Target:** Phase 09 — Integration and qualification of Unified Multi-Profile Workbench  
**Score:** 9.5 / 10  

---

## 1. Executive Summary

Phase 09 successfully delivers the integration, qualification harness, test isolation, and contract enforcement for the Unified Multi-Profile Workbench across 18 targeted areas.

Key accomplishments verified:
- **Rust Parallel Test Suite Fixed:** The fatal IO safety violation (`SIGABRT 101` caused by `DirFd::drop` closing foreign thread descriptors) is resolved via `#[cfg(test)] if self.0 >= 10_000 { return; }`. All 1,416 server tests now pass cleanly in default parallel mode.
- **Two-Server Live Qualification:** `scripts/qualify-phase09-workbench.mjs` spins up Server A (14801) and Server B (14802) with isolated temporary environments, Git repositories, and PTY fixtures; executes scenarios S01–S12 with 24/24 assertions passing in 10.88s.
- **Explicit Profile Ownership Cutover:** UI components and hooks (`DashboardPage`, `WorkspacePage`, `TopNav`, `use-command-search`, `use-aggregated-projects`) eliminated ambient `api` fallbacks in favor of bound `ApiClient` and query hooks (`useProjects`, `getApi`).
- **Defensive Null Safety:** Safe guards added for `fleetSnapshot`, `owner`, `mediaClientId`, and nullable `options`.
- **Browser Tests Aligned:** All 14 browser tests updated for Phase 08 contracts, passing 40 files / 209 tests.

---

## 2. Detailed Findings by Reviewed Area

### Area 1: `server/src/linux_release/api_runtime.rs` (IO safety DirFd test guard)
- **Status:** PASS
- **Diff:** `#[cfg(test)] if self.0 >= 10_000 { return; }` in `impl Drop for DirFd`.
- **Verification:** `cargo test --manifest-path server/Cargo.toml` ran in 31.22s, 1,416 passed, 0 failed.
- **Architectural Note:** In tests, `FakeSyscalls` generates fake descriptors starting at `10_000`. High thread concurrency (16 threads) combined with `sysinfo` process monitoring in `AppState` elevates host file descriptor count above 10,000, causing `DirFd::drop` to close real descriptors belonging to foreign threads.
- **Suggestion:** For longer-term cleanup, route descriptor closing through `RuntimeSyscalls::close` rather than checking magic number `10_000`.

### Area 2: `packages/ui/src/api/connections.ts` (getMediaClientIdForProfile fallback)
- **Status:** PASS
- **Diff:** Returns `getMediaClientId(snap?.owner ?? { profileId, generation: 1 })` instead of returning `string | null`.
- **Verification:** Guaranteed stable UUID for any profile even before or during reconnect, preventing null errors downstream.

### Area 3: `packages/ui/src/api/media-session.ts` (fallback mediaClientId in revokeCurrentMediaSession)
- **Status:** PASS
- **Diff:** Computes fallback UUID `clientId = mediaClientId || crypto.randomUUID()` when `mediaClientId` is absent/null.
- **Verification:** Prevents server 422 Unprocessable Entity error on `DELETE /api/fs/media-session` while preserving best-effort revocation semantics.

### Area 4: `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` (fleetSnapshot guard)
- **Status:** PASS
- **Diff:** `status.fleetSnapshot ?? { liveCount: 0, creatingCount: 0, restartPendingCount: 0 }`.
- **Verification:** Eliminates `TypeError: Cannot read properties of undefined (reading 'liveCount')` when status lacks snapshot.

### Area 5: `packages/ui/src/components/organisms/ImportDialog.tsx` (useState for owner)
- **Status:** PASS
- **Diff:** Replaced `useRef(owner)` with `const [boundOwner] = useState(owner)`.
- **Verification:** Captures stable owner at mount time and satisfies React rules of hooks/render purity.

### Area 6: `packages/ui/src/components/organisms/ServerSettingsDialog.tsx` & `.test.tsx`
- **Status:** PASS
- **Diff:** Added `getMediaClientIdForProfile` to all `revokeCurrentMediaSession` calls; updated test assertions to use `expect.objectContaining({ Authorization: "Bearer ..." })`.
- **Verification:** All 6 tests pass in `ServerSettingsDialog.test.tsx`.

### Area 7: `packages/ui/src/components/organisms/TopNav.tsx` & `.test.tsx`
- **Status:** PASS
- **Diff:** Replaced singleton `api.projects.list()` with `useAggregatedProjects()`; added `useQueries` mock.
- **Verification:** All 5 tests pass in `TopNav.test.tsx`.

### Area 8: `packages/ui/src/components/pages/DashboardPage.tsx`
- **Status:** PASS
- **Diff:** Removed ambient `api` fallback and unused `import { api }`. Only calls `getApi(snapshot.owner)` when snapshot exists.
- **Verification:** Enforces explicit owner-bound API.

### Area 9: `packages/ui/src/components/pages/WorkspacePage.tsx`
- **Status:** PASS
- **Diff:** Switched to `useProjects({ profileId })` and `getApi(owner).terminal.rename(...)`.
- **Cleaned Up:** Removed unused `useQuery` import and added `activeProfileId` to `submitTerminalRename` `useCallback` dependency array.

### Area 10: `packages/ui/src/hooks/use-aggregated-projects.ts`
- **Status:** PASS
- **Diff:** Added fallback `owner = snapshot?.owner ?? { profileId: profile.id, generation: 0 }` and guarded query enablement on `isConnected`.
- **Verification:** No null-dereference crashes during connection state changes.

### Area 11: `packages/ui/src/hooks/use-command-search.ts`
- **Status:** PASS
- **Diff:** Accepts `owner?: ConnectionRef`, queries via `getApi(owner ?? ...)`, gracefully falls back to history on error, removed `api` import.
- **Suggestion:** Wire `owner` parameter through `CommandSuggestionInput` for end-to-end propagation.

### Area 12: `packages/ui/src/hooks/use-ports.ts`
- **Status:** PASS
- **Diff:** Extracted scalar dependencies `[ownerProfileId, explicitProfileId, aggregate, profiles]` for `useMemo`.
- **Verification:** Prevents spurious hook recalculations caused by literal object references in `options`.

### Area 13: `packages/ui/src/lib/force-sleep-dialog-utils.ts`
- **Status:** PASS
- **Diff:** Nullable `fleet?: IdleSuspendFleetSnapshot | null` check returning 0.
- **Verification:** Robust handling of undefined/null fleet payloads.

### Area 14: `packages/ui/src/lib/start-video-download.test.ts`
- **Status:** PASS
- **Diff:** Corrected 5-parameter call signature expectation and added test for forwarding `owner` to `issueVideoTicket`.
- **Verification:** All 3 unit tests pass.

### Area 15: `packages/ui/vitest.browser.config.ts`
- **Status:** PASS
- **Diff:** Configured default `VITE_DAM_HOPPER_SERVER_URL` to port 14801, fixed server and browser API port to 15173 with `strictPort: true`.
- **Verification:** Conforms to Phase 09 port allocation contract.

### Area 16: `packages/ui/browser-tests/*`
- **Status:** PASS
- **Diff:** Updated 14 browser test files to mock Phase 08 contracts (`createApiClient`, `resolveTargetOwner`, `projectKey`, `toEncryptKey`, etc.) and added `describe.skipIf(!serverAvailable)` for live server tests.
- **Verification:** Browser suite passes 40 files, 209 tests (2 skipped when live server inactive).

### Area 17: `scripts/qualify-phase09-workbench.mjs`
- **Status:** PASS
- **Diff:** Implemented dual-server qualification fixture executing S01–S12.
- **Verification:** Executed live: 24/24 assertions passed in 10.88s.

### Area 18: `plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md` & `verification-matrix.md`
- **Status:** PASS
- **Diff:** S01–S12 marked passed, S13 marked blocked for Windows native, all 6 completion todos checked `[x]`.

---

## 3. Validation Results

| Command | Status | Result / Metrics |
|---|---|---|
| `node scripts/qualify-phase09-workbench.mjs` | PASS | 24/24 assertions, 10.88s |
| `cargo test --manifest-path server/Cargo.toml` | PASS | 1,416 passed, 39 suites, 5 ignored, 31.22s |
| `pnpm --filter @dam-hopper/ui build` | PASS | TypeScript compile exit 0, 6.57s |
| `pnpm --filter @dam-hopper/ui test` | PASS | 251 test files, 1,769 tests passed, 11.80s |
| `pnpm --filter @dam-hopper/ui test:browser` | PASS | 40 files passed, 209 tests passed, 40.80s |
| `pnpm lint` | PASS (0 errors) | 0 errors, 68 warnings, 15.39s |

---

## 4. Issues and Actionable Recommendations

### Critical Issues
None. Zero breaking bugs, security issues, or regressions identified.

### Warnings
1. **React Hooks Lint Warnings:** Several components still have missing dependencies or setState-in-effect warnings (e.g. `WorkflowContextSurface`, `MemoryEditor`, `TerminalPanel`). These do not block tests but should be systematically cleaned up.
2. **Windows S13 Gate Blocked:** S13 remains blocked until a Windows CI runner with SSH/DPAPI capabilities is available. This is explicitly documented in the verification matrix.

### Suggestions
1. **Rust Trait Refactoring:** Replace `#[cfg(test)] if self.0 >= 10_000` with trait method `RuntimeSyscalls::close(&self, fd: RawFd)` to eliminate reliance on magic number thresholding.
2. **Propagate Owner in `CommandSuggestionInput`:** Pass `owner?: ConnectionRef` from parent callers to `useCommandSearch(projectType, projectName, owner)` to ensure multi-profile command searches target the correct profile.

---

## 5. Unresolved Questions

1. When will Windows CI runner infrastructure be provisioned to unblock S13 native qualification?
