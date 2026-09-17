# Code Review: Phase 05 — Agents, Ports, and Browser (Cycle 2 Review)

## Code Review Summary

### Score: 9.5/10

### Scope
- Files reviewed:
  - `packages/ui/src/hooks/use-feature-flag.ts`
  - `packages/ui/src/hooks/use-feature-flag.test.ts`
  - `packages/ui/src/components/pages/WorkspacePage.tsx`
  - `packages/ui/src/hooks/use-ports.ts`
  - `packages/ui/src/hooks/use-ports.test.ts`
  - `packages/ui/src/components/organisms/ShipDialog.tsx`
  - `packages/ui/src/components/organisms/PortsPanel.tsx`
  - `packages/ui/src/components/organisms/PortsPanel.test.tsx`
  - `server/tests/linux_release_preflight_sqlite.rs`
- Lines of code analyzed: ~650
- Review focus: Cycle 2 verification of warnings & suggestions fixes (connection subscription, terminal candidate incarnation check, port:lost session filtering, unused import cleanup, ShipDialog error reset).
- Updated plans: `plans/260916-2137-unified-profile/phase-05-agents-ports-and-browser.md`

---

### Overall Assessment
All items raised in Cycle 1 review warnings and suggestions have been correctly addressed:
1. `useFeatureAvailability` in `use-feature-flag.ts` subscribes to connection state changes via `useSyncExternalStore` using `subscribeConnections`, eliminating the reactivity gap.
2. `prepareBrowserTerminalArtifact` in `WorkspacePage.tsx` re-queries `browserTerminalTargets` and re-verifies `candidate.incarnation` against `snapshotTerminalInstanceRef.incarnation` after both `createArtifact` and `uploadPng` awaits. Any target mutation, closure, or incarnation drift deletes the artifact and aborts before handoff.
3. `usePorts` in `use-ports.ts` correctly filters `port:lost` by `p.port !== port || p.session_id !== session_id || p.incarnation !== incarnation`, preventing accidental eviction of co-existing sessions listening on identical port numbers.
4. Unused `Path` import in `server/tests/linux_release_preflight_sqlite.rs` removed; `cargo check --test linux_release_preflight_sqlite` compiles cleanly with zero warnings.
5. `ShipDialog.tsx` resets error state on target toggle (`if (error) setError(null)`).

An unmocked `portEntryKey` export in `PortsPanel.test.tsx` was identified and patched during validation, bringing full unit test suites to 100% pass rate.

---

### Critical Issues
None.

---

### Warnings
None.

---

### Suggestions
1. **ShipDialog method toggle error reset (`ShipDialog.tsx:129`)**:
   Target toggle clears `error`, but toggling the distribution method (`symlink` vs `copy`) retains any existing error text until submission. Consider clearing `error` on distribution method change as well for consistency.
2. **Nullable comparison symmetry in `prepareBrowserTerminalArtifact` (`WorkspacePage.tsx:647, 669`)**:
   `freshTarget?.incarnation !== snapshotTerminalInstanceRef.incarnation` correctly detects terminal closing (`undefined !== 0`) when `snapshotTerminalInstanceRef.incarnation` defaults to `0`. Making this check explicit (`!freshTarget || freshTarget.incarnation !== snapshotTerminalInstanceRef.incarnation`) would improve readability for future maintainers.

---

### Positive Observations
- Clean, idiomatic `useSyncExternalStore` pattern in `useFeatureAvailability` returning primitive string snapshots to prevent unnecessary re-renders.
- Defensive cleanup in `prepareBrowserTerminalArtifact`: always cleans up the created artifact via `deleteArtifact` if validation fails after creation.
- Strict de Morgan filter condition in `usePorts` `port:lost` cache updates ensuring precise multi-session port tracking.
- Test coverage across all critical capability and multi-profile isolation paths.

---

### Reviewed Files
- `packages/ui/src/hooks/use-feature-flag.ts`
- `packages/ui/src/hooks/use-feature-flag.test.ts`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/hooks/use-ports.ts`
- `packages/ui/src/hooks/use-ports.test.ts`
- `packages/ui/src/components/organisms/ShipDialog.tsx`
- `packages/ui/src/components/organisms/PortsPanel.tsx`
- `packages/ui/src/components/organisms/PortsPanel.test.tsx`
- `server/tests/linux_release_preflight_sqlite.rs`

---

### Metrics
- Type Coverage: 100% (TypeScript build `tsc -p tsconfig.json` clean, zero errors)
- Test Suite Status:
  - Vitest UI targeted: 7/7 test files passed, 36/36 tests passed (718ms)
  - Backend integration tests: 5/5 tests passed (`browser_debug_artifacts`)
  - Backend unit tests: 5/5 passed (`browser_debug`)
  - Backend sqlite preflight tests: 11/11 tests passed (`linux_release_preflight_sqlite`)
- Compiler / Linter Warnings: 0 warnings across both UI and Rust compiler outputs.

---

### Validation Commands and Results
1. `pnpm --filter @dam-hopper/ui test src/hooks/use-ports.test.ts src/hooks/use-feature-flag.test.ts src/lib/browser-debug-address-history.test.ts src/hooks/use-browser-debug.test.ts src/lib/browser-terminal-handoff.test.ts src/lib/browser-debug-origin.test.ts src/components/organisms/PortsPanel.test.tsx`
   - PASSED (7 test files, 36/36 tests passed; wall 1.27s)
2. `pnpm --filter @dam-hopper/ui build`
   - PASSED (tsc clean; wall 6.61s)
3. `cd server && cargo test --test browser_debug_artifacts`
   - PASSED (5/5 tests passed; wall 0.90s)
4. `cd server && cargo test browser_debug`
   - PASSED (5/5 tests passed; wall 0.35s)
5. `cd server && cargo test --test linux_release_preflight_sqlite`
   - PASSED (11/11 tests passed; wall 0.20s)
6. `cd server && cargo check`
   - PASSED (zero warnings; wall 0.16s)

---

### Unresolved Questions
None.
