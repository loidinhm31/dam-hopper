# Phase 03 — Owner-Bound Client and Refresh

## Context links
- [Parent](./plan.md), [contracts](./contracts.md), [frontend design](./research/frontend-contract.md).
- Dependency: [Phase 02](./phase-02-native-read-api.md) supplies folder/selected DTOs, strict read mode and watch-only/loss semantics.
- [Ownership standards](../../docs/code-standards.md#ownership-and-asynchronous-work), [workflow client](../../docs/workflow-client-state.md).

## Overview
- Date: 2026-10-06. Priority: P2. Estimate: 6h, not a commitment.
- Implementation status: complete. Review status: complete.
- Add owner-bound folder, selected-plan and document queries with bounded navigation-watch reconciliation. No bulk plan load, new transport, global store or explorer tree cache.

## Key Insights
- Existing watchers are nonrecursive (`server/src/fs/watcher.rs:90–97`). Root-only watching misses nested progress edits.
- Existing tree subscriptions compute snapshots and the explorer hook updates unrelated caches; do not mount that hook for unused tree data.
- WsTransport already exposes onFsOverflow. Watch-only options and strict read mode are narrow shared-seam changes from Phase 02, not invented capabilities.
- Owner generation and target identity are independent of equal project/plan names; lifetime guards also protect delayed subscription cleanup.

## Requirements
- Typed folder/selected/document APIs; server parser alone owns status/date semantics.
- Enable reads/watchers only for expanded dashboard, valid configured target and connected captured owner.
- File-plan and manual-workflow availability remain independent.
- Observe absent-root creation, current group directory changes, selected nested edits/atomic replacement, removal/recreation and event loss. No periodic full scans or sibling-status reads.
- Explicit stale/degraded banner when live coverage fails; manual Refresh remains usable.

## Architecture
- Create `project-plans-types.ts`, `project-plans-queries.ts`, `use-project-plans.ts`.
- Folder key: `profileQueryKey(owner, 'plan-folders', project, normalizedWorktreeOrNull, browsePath)`.
- Selected key: `profileQueryKey(owner, 'plan', project, normalizedWorktreeOrNull, planPath)`. Document key adds strict read mode and normalized target-relative document path; never mix strict/plain reads.
- Selection contains captured owner, target, planPath and document path. Browse/selection lifetimes fence same-owner same-target switches too. Subscription records stay effect-local on originating transport, not query data.
- Nonrecursive watch set: target root `.`, existing ancestors and current browse/selected directory, max33; one selected evidence parent may be added. Never subscribe to all listed children.
- One serialized reconciliation per active navigation/selection; event bursts coalesce; no timer polling all plans/projects or duplicate socket.

## Related code files
Under `/home/loidinh/WS/dam-hopper/`:
- Create `packages/ui/src/api/project-plans-types.ts`: backend-aligned DTOs and closed status/source/date types.
- Create `packages/ui/src/api/project-plans-queries.ts`: owner/target/path-scoped folder/selected/document queries and success/error handling.
- Create `packages/ui/src/hooks/use-project-plans.ts`: watch-set lifetime/reconciliation, scoped invalidation, coverage state.
- Modify `packages/ui/src/api/client.ts`: typed `api.plans.folders(target,path)` and `api.plans.read(target,planPath)`, strict FS read/watch-only options through captured client; retain ownership stripping.
- Modify `packages/ui/src/api/ws-transport.ts`: `plans:folders`/`plans:read` -> protected REST GETs, watchOnly/readMode serialization, existing overflow seam as needed.
- Intentionally unchanged `api/{connections,ownership,query-client}.ts`, `hooks/use-fs-subscription.ts`: reuse ownership/keys without changing explorer conventions.
- Create focused `project-plans-queries.test.ts`, `use-project-plans.test.tsx` for consumer-visible stale-result and coverage transitions. Use existing generation-fenced fixtures.

## Implementation Steps & Outcomes
1. **LSP Callsites & Backward-Compatible Seams:** Preserved generic IDE filesystem read/tree operations while adding optional `mode: "plan-document"` and `watchOnly: true` to transport seams in `client.ts` and `ws-transport.ts`.
2. **Wire DTOs, Diagnostic Constants & Decoders:** Defined backend-aligned types in `project-plans-types.ts` with runtime decoders (`decodePlanFoldersResponse`, `decodeSelectedPlanResponse`, `decodeBase64Utf8`).
3. **Owner-Bound Query Keys & Double-Fenced Fetchers:** Implemented in `project-plans-queries.ts` with profile generation isolation (`planFoldersQueryKey`, `selectedPlanQueryKey`, `planDocumentQueryKey`) and generational error assertions (`ConnectionOwnerError`).
4. **Target-Root Watch & Nonrecursive Directory Navigation:** Mounted `.` target-root watch and current folder in `use-project-plans.ts`; deduplicated navigation watch paths on originating transport.
5. **Add-Before-Remove Watch Reconciliation:** Reconciled active watch sets with maximum 33 active paths and 8 concurrent registrations without subscribing to unselected siblings.
6. **Scoped Invalidation:** Scoped query invalidations on filesystem change events without full tree polling or sibling status reads.
7. **Filesystem Overflow Recovery & Degraded Coverage:** Handled `onFsOverflow` by disposing handles, invalidating queries, and reconnecting; throttled excessive churn (max 3 passes) to degraded coverage.
8. **Strict Document Reading:** Supported strict `mode: "plan-document"` UTF-8 base64 decoding for selected plans with evidence parent directory watch.
9. **Lifetime & Delayed Subscription Cleanup:** Immediately unsubscribes late-resolving tree subscriptions on component unmount or target switch.
10. **Target Switch & Manual Refresh:** Reset selected queries and watchers on navigation/back; manual `refresh()` forces authoritative invalidation and reconciliation.
11. **Behavioral Regressions:** Implemented 15 tests in `project-plans-queries.test.ts` and 7 tests in `use-project-plans.test.tsx` verifying path normalization, generational fencing, overflow recovery, churn limiting, and unmount cleanup.

## Todo list
- [X] Exact types, REST adapter and owner-bound API.
- [X] Folder/selected/document identities, cancellation and same-target selection fencing.
- [X] Bounded attach -> authoritative refetch navigation-watch reconciliation.
- [X] Overflow/close/reconnect/target switch cleanup.
- [X] Explicit stale/degraded state and behavioral regression cases.

## Verification Evidence
22/22 targeted tests passing across `project-plans-queries.test.ts` and `use-project-plans.test.tsx`:
- `packages/ui/src/api/project-plans-queries.test.ts` (15 tests, TAP ok):
  - Path Normalization:
    - normalizes empty or null browse path to 'plans'
    - normalizes nested browse paths and plan paths cleanly
  - Query Key Builders:
    - builds owner-bound folder query keys
    - builds owner-bound selected plan query keys
    - builds owner-bound document query keys with strict mode
    - builds prefix query keys for scoped invalidations
  - Type Guards and Decoders:
    - validates and decodes PlanFoldersResponse correctly
    - validates and decodes SelectedPlanResponse correctly
    - decodes UTF-8 base64 encoded document text
  - Fetchers and Query Option Factories:
    - rejects fetch when owner connection is stale or disconnected
    - fetches plan folders using bound client
    - fetches selected plan using bound client
    - fetches plan document with plan-document mode and decodes content
    - throws ApiRequestError when document read fails
    - produces query options that reflect enabled state
- `packages/ui/src/hooks/use-project-plans.test.tsx` (7 tests, TAP ok):
  - reports unsupported coverage and disables queries when disabled or missing owner
  - mounts folder browsing and reaches live coverage
  - switches to selected plan and reconciles watch set
  - immediately unsubscribes if unmounted before delayed subscription completes
  - handles filesystem overflow by disposing handle, invalidating, and reconciling
  - limits excessive churn to degraded coverage and recovers with manual refresh
  - cleans up active subscriptions on unmount
- `@dam-hopper/ui` TypeScript Build (`pnpm --filter @dam-hopper/ui build`): `tsc -p tsconfig.json` exit code 0, 0 errors.
- `@dam-hopper/ui` Full Unit Suite (`pnpm --filter @dam-hopper/ui test`): 304/304 test files passed, 2,347/2,347 tests passed (0 failures).
- `@dam-hopper/ui` Browser Suite (`pnpm --filter @dam-hopper/ui test:browser`): 51 passed files, 258 passed tests (0 failures).

## Success Criteria
- Old-generation/target data cannot appear in the new dashboard, mutate selection or unsubscribe the replacement owner's resource.
- Creation/removal/atomic replacement reaches current folders or selected overview/detail through actual FS notifications after Phase 05 smoke.
- Initially absent root works; current navigation has bounded observable coverage or a visible failure. Listed siblings are neither parsed nor watched.
- No unused explorer snapshots/caches, global polling loop, duplicate transport or persisted plan status.
- Existing manual workflow queries and filesystem consumers remain compatible with new optional request fields.

## Risk Assessment
- Continuous writer churn: bounded reconcile passes then explicit unsettled coverage; do not spin indefinitely or label an incomplete watch set live.
- Connection replaced during cleanup: hold original transport; never look up ambient transport for unsubscribe.
- Event path normalization differs across platforms: compare canonical target-relative paths and both rename sides; no raw prefix tests accepting sibling paths.
- Unsupported old server: show file feature unavailable; keep manual tracking usable.

## Security Considerations
- Target/owner is captured before every async read or subscription; recheck before callbacks/selection/cache-side actions.
- Strict detail server boundary remains authoritative; client normalization is not authorization.
- No source document bodies/absolute private paths in routine diagnostics or query-derived logs.

## Next steps
- Phase 04 consumes folder/selected/watch/read contracts and coverage state; Phase 05 proves actual server-to-UI transitions.
- Unresolved questions: none requiring product input. Numeric resource/date/parser bounds are frozen in contracts.md.
