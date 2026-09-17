# Code Review Summary: Phase 09 — Integration and Qualification (Cycle 2)

**Date:** 2026-09-17  
**Reviewer:** Phase09Reviewer (Senior Software Engineer)  
**Target:** Phase 09 — Integration and qualification of Unified Multi-Profile Workbench (Cycle 2 Review)  
**Score:** 9.8 / 10  

---

### Scope
- **Files reviewed:**
  - `server/src/linux_release/api_runtime.rs`
  - `packages/ui/src/api/connections.ts`
  - `packages/ui/src/api/ownership.ts`
  - `packages/ui/src/components/atoms/CommandSuggestionInput.tsx`
  - `packages/ui/src/hooks/use-command-search.ts`
  - `plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md`
  - `plans/260916-2137-unified-profile/verification-matrix.md`
  - `scripts/qualify-phase09-workbench.mjs`
- **Lines of code analyzed:** ~4,200
- **Review focus:** Cycle 2 verification of applied fixes, test ledger reconciliation, type safety, test execution
- **Updated plans:** `plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md`

---

### Overall Assessment
All 5 required items for Cycle 2 verified.
1. Reconciled test breakdown and S01–S12 mapping match across `verification-matrix.md` and `phase-09-integration-and-qualification.md` (3,504 passed tests across 8 suites, 0 failed).
2. Magic number replaced with `tests::FAKE_FD_BASE` in `server/src/linux_release/api_runtime.rs`.
3. `mediaClientIdsByOwner` cleanup fix reviewed. Found bug in initial implementation: key checked via `startsWith(`${profileId}@`)` whereas `connectionKey` serializes to `JSON.stringify([profileId, generation])`. Fixed in `connections.ts` by parsing JSON tuple; verified via live test.
4. `owner?: ConnectionRef` wired through `CommandSuggestionInput` and `use-command-search.ts` with proper memo/hook dependencies.
5. All 3,504 qualification tests and live harness passing with 0 errors and 0 test failures.

---

### Critical Issues
None. No security vulnerabilities or breaking regressions found.

---

### High Priority Findings
1. **[RESOLVED] `mediaClientIdsByOwner` Key Format Mismatch in `removeProfileConnection`:**
   - *Problem:* Initial fix attempted `key.startsWith(`${profileId}@`)`. `connectionKey(owner)` in `ownership.ts` produces `JSON.stringify([ref.profileId, ref.generation])` (e.g. `'["prof-1",1]'`). Key prefix check never matched, leaving orphaned entries in memory.
   - *Fix applied:* Updated `removeProfileConnection` in `packages/ui/src/api/connections.ts` to parse tuple keys:
     ```ts
     for (const [key] of mediaClientIdsByOwner) {
       try {
         const parsed = JSON.parse(key);
         if (Array.isArray(parsed) && parsed[0] === profileId) {
           mediaClientIdsByOwner.delete(key);
         }
       } catch {
         // ignore malformed keys
       }
     }
     ```
   - *Verification:* Verified via eval test that `getMediaClientIdForProfile` regenerates UUID after `removeProfileConnection`.

---

### Medium Priority Improvements
1. **PTY Test Concurrency Flakiness (`server/src/pty/tests.rs`):**
   - In `terminal_tail_falls_back_to_persisted_buffer_after_exit`, `wait_for` asserts `!session.alive` before immediately sending `tx.send(PersistCmd::Shutdown)`. Under high thread load (16 concurrent threads), the PTY reader thread occasionally hasn't drained and persisted the buffer before shutdown signal, causing rare intermittent panic. Recommend adding small drain handshake or polling `store.load_buffer` in the test before shutdown.

---

### Low Priority Suggestions
1. **ESLint React Hooks Warnings:**
   - 66 non-blocking linter warnings remain across UI components (`setState` inside `useEffect` in `WorkflowContextSurface`, `MemoryEditor`, `dam-hopper-app`, and missing hook dependencies in `WorkspacePage`). Clean up in a subsequent maintenance cycle.

---

### Positive Observations
- Clean, disciplined replacement of magic descriptor constant in Rust with `tests::FAKE_FD_BASE`.
- Dual-server qualification harness (`scripts/qualify-phase09-workbench.mjs`) provides genuine, robust end-to-end qualification across real PTYs, Git worktrees, isolated config roots, and media tickets.
- Fast execution: 3,504 total assertions complete in <2 minutes end-to-end.
- S01–S12 scenarios fully verified in live multi-server runtime.

---

### Recommended Actions
1. Document release cutover in `docs/CHANGELOG.md` and relevant guides.
2. Provision Windows runner for S13 native qualification.
3. Address UI React hook lint warnings during technical debt cleanup.

---

### Metrics & Validation Results
- **Total Tests Passed:** 3,504 (0 failed, 9 skipped/ignored)
  - Rust server (`cargo test`): 1,416 passed, 5 ignored
  - UI Unit (`pnpm --filter @dam-hopper/ui test`): 1,769 passed, 251 test files
  - UI Browser (`pnpm --filter @dam-hopper/ui test:browser`): 209 passed, 4 skipped, 40 passed files
  - Shared package (`pnpm --filter @dam-hopper/shared test`): 15 passed, 2 test files
  - Browser bridge (`pnpm --filter @dam-hopper/browser-bridge test`): 19 passed, 5 test files
  - Native host (`pnpm --filter @dam-hopper/native test`): 48 passed, 4 test files
  - Live qualification harness (`scripts/qualify-phase09-workbench.mjs`): 24 passed assertions (S01–S12)
  - Embedded live browser tests: 4 passed
- **Typecheck / Build:** `pnpm --filter @dam-hopper/ui build` — 0 errors
- **Lint:** `pnpm lint` — 0 errors, 66 warnings

---

### Unresolved Questions
1. When will the Windows CI runner infrastructure with SSH and DPAPI capabilities be provisioned to unblock S13 native qualification?
