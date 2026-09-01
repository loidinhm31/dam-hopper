# Phase 04 — Client Types, Transport, and Query State

## Context Links
- [Plan](./plan.md)
- [Phase 02](./phase-02-workflow-service-and-rest-api.md)
- [API client](../../packages/ui/src/api/client.ts)
- [REST operation mapper](../../packages/ui/src/api/ws-transport.ts)
- [Profile-scoped query hash](../../packages/ui/src/api/query-client.ts)
- Depends on: Phase 02. Enables Phase 05.

## Overview
- **Date:** 2026-09-01
- **Description:** Add strict shared-UI workflow DTOs, transport mappings, profile/workspace-safe query hooks, mutation invalidation, and view-state ownership.
- **Priority:** P2
- **Implementation status:** Pending
- **Review status:** Pending

## Key Insights
- `api/client.ts` is transport-agnostic while `ws-transport.ts` maps operation names to protected REST endpoints.
- `profileScopedQueryKeyHash` already prefixes every TanStack key with active profile ID. Workflow keys must also rebind to transport generation/workspace result and never persist cross-profile data locally.
- React Query owns server state; deck open/segment/filter/draft/focus state stays component-local. No workflow Zustand store or localStorage cache.
- Existing `useSearchParams` is terminal navigation state. Workflow UI must not read/write it except through existing terminal navigation actions in Phase 06.
- Manual timestamp drafts are presentation state. **Now** fills the same editable field with the current local instant; it is not a distinct API action, and observed terminal times remain separate suggestions.

## Requirements
- Mirror backend enums exactly; preserve user-entered `startedAt`/`endedAt`, resource observed state, and `suggestedEndedAt` as distinct fields without client-authoritative correction.
- Preserve Plan-first shape: Plan rows can have no children; optional Phases/direct Tasks nest under Plans; standalone Tasks remain separate. Notes/sessions may reference a Plan directly.
- Expose factual `trackedTaskCount`/`completedTrackedTaskCount` and `null` progress when no tracked Tasks exist. UI helpers must label counts as tracked work, never infer total Plan completion.
- Expose API functions for overview, event page, item CRUD, manual session start/end/abandon, terminal/manual-harness links, notes, and purge.
- Generate request IDs once per user action with `crypto.randomUUID()` and retain through the mutation promise; do not regenerate on transport retry.
- Query key root is `['workflow']`; overview includes transport generation, while global profile hash isolates the current server profile. Invalidate the root after successful mutations; never aggregate profiles.
- Do not poll overview continuously. Refetch on window focus/reconnect and after mutation; elapsed labels tick locally from the manually submitted `startedAt` without changing cached data.
- No optimistic snapshot writes in MVP. Preserve previous overview during refetch; show per-action pending/error state and retry.
- Normalize API errors into code/message/resource fields; never render raw response bodies or path-bearing diagnostics.

## Architecture
- `workflow-types.ts`: DTO/request discriminated unions plus helpers for provenance, Plan-first grouping/parent validation, factual tracked-Task labels, manual timestamp validation/elapsed labels, resource observed state/suggestions, derived stale attention, and item ordering.
- `workflow-queries.ts`: query key factory, hooks, request-ID helper, invalidation, and mutation wrappers.
- `client.ts`: `api.workflow` delegates named operations through active transport.
- `ws-transport.ts`: pure REST method/path/body/query mapping. Events/history cursor remains URL-encoded and bounded.
- Cache flow: active profile → query hash → transport generation → overview → local presentation. Profile replacement destroys old transport; old responses cannot populate the new scoped key.

## Related Code Files
### Modify
- `packages/ui/src/api/client.ts` — import/export workflow types and add `api.workflow` methods.
- `packages/ui/src/api/ws-transport.ts` — map workflow operations to REST.
- `packages/ui/src/api/ws-transport.test.ts` — method/path/body/cursor/request-ID coverage.
- `packages/ui/src/api/query-client.ts` — unchanged unless a test reveals current profile hash does not isolate transport replacement.
### Create
- `packages/ui/src/api/workflow-types.ts` — strict contracts and derived helpers.
- `packages/ui/src/api/workflow-queries.ts` — focused query/mutation hooks.
- `packages/ui/src/api/workflow-types.test.ts` — Plan-only/optional hierarchy grouping, factual counts, manual timestamp, suggestion separation, transition/provenance/elapsed/stale helpers.
- `packages/ui/src/api/workflow-queries.test.tsx` — cache isolation, invalidation, replay-ID behavior.
### Delete
- None.

## Implementation Steps
1. Transcribe backend response/request types and enum unions. Keep structured `ProjectTargetRef`; model direct Plan ownership and optional children explicitly, not through generic payload maps.
2. Add `api.workflow` operations with stable names (`workflow:overview`, `workflow:createItem`, etc.). Pass bodies unchanged after type checking.
3. Add mapper cases with `encodeURIComponent` for resource IDs/cursors and exact methods. Keep manual end/abandon actions distinct and carry timestamp bodies unchanged.
4. Build `workflowQueryKeys.overview(transportGeneration)` and `.events(cursor,limit)` under one root. Rely on `profileScopedQueryKeyHash` for current-profile isolation.
5. Implement overview query with `placeholderData` from its own scoped prior value, no interval, reconnect/focus refresh, and explicit enabled state when transport is ready.
6. Implement selectors that group Plans first, preserve optional Phase/direct Task children, list standalone Tasks separately, and render `x/y tracked tasks done` only when `trackedTaskCount > 0`.
7. Implement mutation hooks. Capture caller/request UUID, disable duplicate submit in components, invalidate `['workflow']` only on success, retain typed error on failure.
8. Implement manual time helpers: local-input ↔ instant conversion, `endedAt >= startedAt`, **Now** fill, shared visible elapsed clock, and explicit apply-suggestion behavior. Never copy `suggestedEndedAt` into the draft automatically.
9. Test profile A/B key hashes, transport generation changes, old-response isolation, Plan-only grouping, optional children, standalone Tasks, null progress/factual count labels, direct Plan notes/sessions, manual timestamp round-trip, **Now** equivalence, suggestion non-application, harness-link bounds, mutation failure cache preservation, exact invalidation, cursor encoding, and request-ID stability.

## Todo List
- [ ] DTOs match backend and avoid arbitrary payloads.
- [ ] Plan-first grouping preserves Plan-only records, optional children, direct ownership, standalone Tasks, and factual counts.
- [ ] Transport mapping covers every MVP endpoint.
- [ ] Query keys isolate profile and transport generation.
- [ ] Mutations preserve one request ID and invalidate narrowly.
- [ ] Manual time and observed-resource helpers share one clock without conflating authoritative and suggested values.

## Success Criteria
- Switching profile cannot display the previous server's workflow overview, notes, or errors.
- A workspace/transport switch fetches fresh overview while terminal query semantics remain unchanged.
- Failed mutation leaves authoritative cached state intact and offers safe same-request retry.
- Terminal observations and suggested end times cannot alter manual drafts or cached session timestamps without an explicit user action.
- A Plan without children renders as valid current work with status/last activity/session/note context and never as `0%`.
- No workflow hook reads/writes `useSearchParams`, localStorage, terminal registry, or editor store.

## Risk Assessment
- **Client/server enum drift:** backend integration fixtures and exhaustive TypeScript switches.
- **Stale cross-profile flash:** profile-scoped hash + transport generation; no persisted cache.
- **Timer render load:** one clock; memoized rows; only visible elapsed labels update.
- **Central client growth:** types/hooks live in focused modules; `client.ts` remains thin wiring.

## Security Considerations
- Never log notes, absolute paths, external IDs, or API bodies. Use existing redacting logger only for code/status IDs.
- Treat all note/title text as untrusted React text; no HTML rendering.
- Do not persist workflow data in browser storage; remote profile data dies with query cache scope.
- Error presentation uses sanitized server message and correlation ID, not raw stack/SQL/path.

## Next Steps
- Phase 05 consumes these hooks in accessible responsive components.
- Phase 06 supplies active project/target and existing terminal navigation callbacks.

## Unresolved Questions
None.
