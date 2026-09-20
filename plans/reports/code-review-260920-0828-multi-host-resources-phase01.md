# Code Review: Multi-profile Host Resources watch Phase 01 (Multi-profile state and hooks)

## Code Review Summary

### Scope
- Files reviewed:
  - `packages/ui/src/lib/host-resource-state.ts`
  - `packages/ui/src/hooks/use-multi-host-resources.ts`
  - `packages/ui/src/lib/host-resource-state.test.ts`
  - `packages/ui/src/hooks/use-multi-host-resources.test.tsx`
  - `plans/260920-0137-multi-profile-host-resources/phase-01-multi-profile-state-and-hooks.md`
  - `plans/260920-0137-multi-profile-host-resources/plan.md`
- Lines of code analyzed: ~1,500 LOC
- Review focus: Phase 01 implementation against functional and non-functional requirements:
  1. Automatic watch scope (`status === "connected" || autoConnect === true`).
  2. Isolated `useQueries` with generation-scoped query keys (`['profile', profileId, generation, 'system', 'resource-snapshot']`) and stale generation rejection (`isCurrentConnection` fence).
  3. Deterministic fleet summary aggregation without metric averaging or describing connection failures as host incidents.
  4. Snapshot alert feeding into `byProfile` presentation store.
  5. Memory/battery and last-known data handling for offline auto-connect targets.
  6. Verification of test suite and build.
- Updated plans:
  - `plans/260920-0137-multi-profile-host-resources/phase-01-multi-profile-state-and-hooks.md`
  - `plans/260920-0137-multi-profile-host-resources/plan.md`

### Overall Assessment
Code quality is high (9.5/10). Implementation strictly adheres to domain rules and specifications. Architectural boundaries between pure aggregation logic (`host-resource-state.ts`) and React/TanStack Query orchestration (`use-multi-host-resources.ts`) are clean and well-factored. Owner isolation and connection generation fencing are robust. Tests cover all major edge cases: empty profiles, mixed connection/auto-connect scopes, partial query failures, late-generation rejections, cross-server incident ID collisions, and `enabled: false`.

During review, test fixture typing in `host-resource-state.test.ts` was corrected to use canonical helper functions (`resolveHostResourceStatus` and `resolveHostResourceEntryStatus`) instead of manually fabricated objects with invalid properties (`colorClass`, missing `triggerClassName`).

### Critical Issues
- None (0). Zero security vulnerabilities, data leaks, breaking wire changes, or unauthorized mutations.

### High Priority Findings
- Fixed: Mock fixture typing drift in `host-resource-state.test.ts`
  - Cause: Test fixtures manually defined synthetic `status` objects containing deprecated/unknown properties (`colorClass`, `borderClass`, `bgClass`, invalid icon `"check"`) while omitting required interface members (`triggerClassName`, `badgeClassName`, `statusClassName`, `statusIconClassName`).
  - Resolution: Replaced manual object literals with real calls to `resolveHostResourceStatus` and `resolveHostResourceEntryStatus`, providing `currentAlerts: []` to reflect valid authoritative snapshots.

### Medium Priority Improvements
- None (0).

### Low Priority Suggestions
- Suggestion 1: In `use-multi-host-resources.ts`, consider storing the connection generation in `lastRecordedRef` alongside `alert` and `alerts` (e.g., `{ generation, alert, alerts }`) for defensive completeness across rapid reconnects, although current value-based equality checking via `reduceAlert` already prevents duplicate unread incidents.

### Positive Observations
- Strict adherence to zero-mutation and zero-connection-initiation constraints (`autoConnect` checks startup intent only).
- Query isolation: each profile is queried independently via generation-qualified keys; partial failures never cascade to peer cards or the entire fleet.
- Accurate fleet unread computation: sums per-profile unread incident counts from `useHostResourceAlertPresentationStore.byProfile` rather than using the global store, preventing cross-profile ID collisions.
- Clear distinction between connection status and host resource alert status: connection failure increments `unavailableCount` without creating synthetic host incidents.
- Offline auto-connect profiles issue zero network requests (`enabled: false`, `refetchInterval: false`).
- Clean handling of cached data as last-known with warning tone and qualifier rather than displaying a false "Healthy" badge.

### Metrics
- Score: 9.5/10
- Type Coverage: 100% (strict TypeScript across all source and test files)
- Test Coverage: 58/58 passing in UI unit suite
- Build: 0 errors (`pnpm --filter @dam-hopper/ui build`)

### Validation Commands & Results
- `pnpm --filter @dam-hopper/ui test src/lib/host-resource-state.test.ts src/hooks/use-multi-host-resources.test.tsx`
  - Result: 2 passed files, 58 passed tests, 0 failed
- `pnpm --filter @dam-hopper/ui build`
  - Result: Exit code 0, TypeScript compiled without errors

### Unresolved Questions
- None.
