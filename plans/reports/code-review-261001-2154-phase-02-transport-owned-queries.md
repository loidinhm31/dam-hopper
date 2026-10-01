# Code Review: Phase 02 — Transport and Owned Queries

**Reviewer**: Senior Software Engineer  
**Date**: 2026-10-01  
**Score**: 9.8 / 10  
**Status**: Approved (ready for Phase 04 / Wave B integration)

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `packages/ui/src/api/client.ts` (lines 2184–2200, 3194–3202)
  - `packages/ui/src/api/ws-transport.ts` (lines 517–541)
  - `packages/ui/src/api/queries.ts` (lines 786–860)
  - `packages/ui/src/api/ws-transport.test.ts` (lines 401–457)
  - `packages/ui/src/api/queries.test.ts` (lines 46–277)
  - `packages/ui/src/api/ownership.test.ts` (lines 221–254)
- **Lines of code analyzed**: ~409 lines modified/added across 6 files
- **Review focus**: Phase 02 transport and owner-scoped query contract
- **Updated plans**:
  - `plans/261001-2003-git-history-search-persistence/phase-02-transport-query-contract.md`
  - `plans/261001-2003-git-history-search-persistence/plan.md`

### Overall Assessment
Clean, robust, and disciplined implementation strictly following YAGNI, KISS, and DRY principles. Extends the existing `git:log` REST route and TanStack Query infrastructure with the optional `messageQuery` parameter without breaking any existing callers or introducing unnecessary abstractions. Ensures full profile and target isolation: browser profile IDs are never exposed on the wire, URLs are safely encoded via `URLSearchParams`, scope-gating reliably disables unresolved queries without unowned fallbacks, and TanStack Query prefix matching preserves invalidation across all search and root variants.

---

### Critical Issues
None.

---

### Warnings (Low Priority)
1. **Type ergonomics for nullable query inputs**:
   - **Location**: `packages/ui/src/api/queries.ts:798` (`gitLogQueryOptions`) and line 855 (`useGitLog`)
   - **Context**: `normalizeGitMessageQuery(query?: string | null)` accepts `string | null | undefined`, but `gitLogQueryOptions` and `useGitLog` define `messageQuery?: string`.
   - **Observation**: React state hooks often initialize nullable values as `useState<string | null>(null)`. Passing `null` requires callers to coerce with `query ?? undefined`.
   - **Fix/Suggestion**: Broaden signature in `queries.ts` to `messageQuery?: string | null` (no runtime change needed since `normalizeGitMessageQuery` already handles `null`).

---

### Suggestions (Low Priority)
1. **Details prefix iteration documentation for Phase 04**:
   - **Location**: `packages/ui/src/api/queries.ts:834` (`gitHistoryQueryPrefixes.details`)
   - **Observation**: `details(hash?)` returns a 3-element tuple array (`git-commit-files`, `git-commit-message`, `git-commit-file-diff`). When invalidating details, the consumer must loop or spread into `Promise.all(details.map(...))`.
   - **Suggestion**: Ensure Phase 04 / Phase 05 controller consumers are documented or provided a small helper method for invalidating all details at once if bulk commit detail cache clearing is needed.

---

### Positive Observations
- **Strict wire projection & owner fence**: `client.ts` uses `toWireTarget(target)`, which validates owner alignment and strips `profileId` before dispatching. No browser-internal metadata leaks to the server wire.
- **Safe parameter encoding**: `ws-transport.ts` uses `URLSearchParams.set("messageQuery", d.messageQuery.trim())` and `encodeURIComponent(d.project)`, avoiding any raw URL string interpolation and protecting against query injection via `&`, `+`, `#`, `?`, `%`, or Unicode characters.
- **Canonical query key agreement**: Query keys normalize empty or missing search terms to `null` (`normalizedQuery || null`), ensuring that `undefined`, `null`, `""`, and whitespace-only strings all produce identical, collision-free query keys.
- **Scope-gating fail-closed design**: When target has an empty project string (`project: ""`), `gitLogQueryOptions` sets `enabled: false` while keeping the target owner intact, preventing unauthorized or unowned ambient log fetches.
- **Full multi-profile isolation testing**: `queries.test.ts` includes a comprehensive test scenario verifying that two distinct profiles with the exact same project name maintain isolated query caches, generation switches fence out old cached queries, and mutation invalidation for one profile never invalidates cache data of another.

---

### Recommended Actions
1. Mark Phase 02 complete in planning artifacts (done).
2. Exported helper contracts (`gitLogQueryOptions`, `gitHistoryQueryPrefixes`, `normalizeGitMessageQuery`) are verified stable and ready for Phase 04 (`use-git-history-view.ts`) and Phase 05 (`WorkspaceGitPanel.tsx`).
3. Proceed to Phase 04 upon completion of Phase 03.

---

### Metrics
- **Type Coverage**: 100% TypeScript strict check passing (`@dam-hopper/ui` and `@dam-hopper/web` clean)
- **Test Coverage**: 71/71 tests passing (100%) across `ownership.test.ts`, `queries.test.ts`, and `ws-transport.test.ts`
- **Linting / Diagnostics**: 0 diagnostics, 0 TODO comments remaining in reviewed files

---

### Validation Commands & Results
1. `pnpm --filter @dam-hopper/ui exec vitest run src/api/ownership.test.ts src/api/queries.test.ts src/api/ws-transport.test.ts`
   - Result: 3 passed, 71 tests passed (546ms)
2. `pnpm --filter @dam-hopper/ui exec tsc --noEmit`
   - Result: 0 errors (clean)
3. `pnpm --filter @dam-hopper/web exec tsc --noEmit`
   - Result: 0 errors (clean)
4. `cargo test git_log` (server regression from Phase 01)
   - Result: 2 passed, 0 failed

---

### Unresolved Questions
None.
