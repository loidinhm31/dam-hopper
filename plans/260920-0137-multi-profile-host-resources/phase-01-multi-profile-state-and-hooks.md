# Phase 01 — Multi-profile state and hooks

## Context links

- [Plan overview](./plan.md)
- [Repository guidelines](../../AGENTS.md)
- [Frontend standards](../../docs/code-standards.md#typescript-frontend-appsweb-appsnative-packagesui)
- [Profile/host architecture](../../docs/system-architecture.md#phase-06-preferences-settings-usage-and-host-resources-2026-09-17)
- [Host monitoring architecture](../../docs/system-architecture.md#host-resource-monitoring-current-delivery-generic-remediation-deferred)
- [Phase 02 consumer](./phase-02-fleet-deck-and-card-components.md)

## Overview

- Date: 2026-09-20
- Priority: P2
- Plan status: DONE (2026-09-20)
- Implementation status: DONE (2026-09-20)
- Review status: DONE (2026-09-20)
- Completion timestamp: 2026-09-20
- Goal: expose one owner-safe, reactive fleet view model without changing backend or connection lifecycle.

## Key Insights

- `getProfiles` + profile-change subscription is the canonical configured-profile source. `getConnectionSnapshot` + connection subscription supplies current status and generation.
- Existing aggregated hooks prove the `useSyncExternalStore` + `useQueries` pattern, but Host Resources must not inherit their ambient empty-profile fallback: an empty fleet is meaningful.
- A connected manual profile belongs in scope even with `autoConnect=false`; a disconnected auto-connect profile remains visible but does not fetch; a disconnected manual profile is excluded.
- The 15s deep snapshot contains host identity, alert state, memory, battery, and sampled time—enough for cards. CPU/storage compatibility metrics remain focused drilldown data.
- `useHostResourceAlertPresentationStore.byProfile` is authoritative for per-card/fleet unread totals. Summing buckets avoids collisions when two servers issue the same `incidentId`.
- Duplicate endpoint/profile labels may represent distinct frontend owners. Never deduplicate or claim distinct physical machines.

## Requirements

### Functional

1. Add `useMultiHostResources({ enabled?: boolean })` in `packages/ui/src/hooks/use-multi-host-resources.ts`.
2. Watch profiles satisfying `status === "connected" || autoConnect === true`, preserving configured profile order.
3. Subscribe reactively to profile list, connection status, intent, and generation changes.
4. Fetch `system.resourceSnapshot()` independently for each connected watched owner through TanStack Query `useQueries`.
5. Record each successful snapshot's `alert` and `currentAlerts` into the alert-presentation store with that profile ID.
6. Return card-ready entries plus a deterministic fleet summary. Never expose one profile's error as fleet-wide query failure.
7. Preserve unavailable, loading, stale, refresh-error, alert severity, connection status, and last-sample age as distinct data.

### Non-functional

- No new dependency, persistence, endpoint, server sampler, or connection attempt.
- No query key may omit profile ID or connection generation.
- Recompute only when profile, connection, query, or relevant `byProfile` alert state changes.
- Keep pure aggregation in `host-resource-state.ts`; keep subscriptions/query orchestration in the hook.

### Preflight contract

Before implementation, confirm these current APIs still exist unchanged: `resolveTargetOwner`, `profileQueryKey`, `getBoundApiClient`, `getProfiles`, `subscribeToProfileChanges`, `getProfileChangeVersion`, `getConnectionSnapshot`, `subscribeConnections`, `isCurrentConnection`, and `useHostResourceAlertPresentationStore.byProfile`. If any drifted, adapt to the canonical replacement; do not add a parallel ownership path.

## Architecture

### Watch target selection

```ts
watched = configuredProfiles.filter((profile) => {
  const connection = getConnectionSnapshot(profile.id);
  return connection?.status === "connected" || profile.autoConnect;
});
```

This is observation only. `autoConnect` expresses startup intent; the hook never calls `connectProfile`.

### Public view model

```ts
export interface MultiHostResourceEntry {
  profile: ServerProfile;
  owner: ConnectionRef;
  connectionStatus: ConnectionStatus;
  connected: boolean;
  watchReason: "connected" | "auto-connect" | "connected-and-auto-connect";
  snapshot?: HostResourceSnapshotV1;
  status: HostResourceStatusPresentation;
  unreadCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isStale: boolean;
}

export interface HostResourceFleetSummary {
  watchedCount: number;
  connectedCount: number;
  attentionCount: number;
  unavailableCount: number;
  unreadCount: number;
  presentation: HostResourceStatusPresentation;
}

export interface UseMultiHostResourcesResult {
  configuredProfileCount: number;
  entries: MultiHostResourceEntry[];
  summary: HostResourceFleetSummary;
}
```

Names may adjust to local TypeScript taste, but consumers must receive these semantics without reaching into Query observers.

### Query construction

For every watched profile:

1. Resolve the owner with `resolveTargetOwner(profile.id)` after the connection subscription snapshot changes.
2. Key snapshots with `profileQueryKey(owner, "system", "resource-snapshot")`.
3. Enable only when the hook is enabled and the connection is currently `connected`.
4. Call `getBoundApiClient(owner).system.resourceSnapshot()`.
5. Before accepting a delayed result, require `isCurrentConnection(owner)`; throw the existing stale-owner error on replacement/disconnect.
6. Use the existing 15,000ms interval only while enabled/connected. Disabled auto-connect cards issue zero network requests.
7. Preserve cached data as last-known presentation after disconnect, but connection state outranks health wording.

`useQueries` owns all rows in one hook invocation. Results join to targets by array index only inside the same memoized target ordering; the exported identity remains `profile.id`.

### Aggregation helpers

Add pure helpers to `host-resource-state.ts`:

- `resolveHostResourceWatchReason(connected, autoConnect)` or equivalent.
- `resolveHostResourceFleetSummary(entries)` selecting highest active severity, then unavailable/stale/loading state, while returning explicit counts.
- Fleet unread = sum of each watched profile's `byProfile[profileId].unreadIds.length`; do not use global `unreadIds` for multi-profile counts.
- `attentionCount` counts profiles whose resource rank is advisory/warning/critical. Connection failure contributes to `unavailableCount`, not a fabricated host incident.
- A fleet with zero watched profiles returns a neutral/unavailable presentation suitable for the empty deck.

Do not average CPU, memory, disk, battery, alerts, or sample ages across hosts.

## Related code files

| File | Action | Purpose |
|---|---|---|
| `packages/ui/src/hooks/use-multi-host-resources.ts` | Create | Profile/connection subscriptions, `useQueries`, per-profile alert recording, public fleet view model. |
| `packages/ui/src/lib/host-resource-state.ts` | Modify | Pure watch-reason and fleet-summary helpers; reuse existing status ranking. |
| `packages/ui/src/hooks/use-host-resource-alert-presentation.ts` | Verify; modify only if selector typing requires | Keep bounded global and `byProfile` state; no second fleet alert store. |
| `packages/ui/src/api/queries.ts` | Verify only | Reuse `resolveTargetOwner` and bound client. Do not add duplicate public resource hooks. |
| `packages/ui/src/api/query-client.ts` | Verify only | Reuse generation-qualified `profileQueryKey`. |
| `packages/ui/src/api/connections.ts` | Verify only | Reuse snapshots/subscriptions/stale-owner check; no lifecycle changes. |
| `packages/ui/src/api/server-config.ts` | Verify only | Reuse profiles, `autoConnect`, and profile list subscription. |

## Implementation Steps

1. Define the public view-model types beside the hook. Import strict domain types; no `any`, stringly query state, or copied DTO shapes.
2. Subscribe to profile revision with `useSyncExternalStore`; memoize `getProfiles()` by revision.
3. Subscribe to a stable serialized connection signature containing each profile ID, status, intent, and owner generation. Do not include mutable object identity.
4. Derive watched targets with the exact union rule. Keep original configured order; do not sort by health because cards would jump during polling.
5. Resolve one current owner per target and construct `useQueries` specs with canonical keys and 15s cadence. Provide disabled specs for offline auto-connect rows so hook ordering remains legal/stable.
6. Fence query completion against current connection generation. A stale result may remain under its old generation key but must not appear in the current entry.
7. Read one `byProfile` snapshot from the Zustand store. Join per-profile unread counts without creating one subscription per row.
8. In an effect, submit successful authoritative snapshot alerts with the matching profile ID. Missing `currentAlerts` retains older-server resource incidents; explicit `[]` clears them through the existing reducer.
9. Project every target/result into `MultiHostResourceEntry`. For disconnected rows, expose last-known data only with explicit connection state; never call it healthy/current.
10. Add pure fleet aggregation. Precedence: active critical > warning > advisory > unavailable/error > sampling/stale > healthy/monitoring. Counts remain separate even when presentation selects one headline.
11. Return stable memoized entries/summary. Do not return mutation callbacks or connection controls.
12. Keep single-profile compatibility in the consumer, not by smuggling ambient fallback into this hook.

## Todo list

- [x] Create strict fleet entry/summary types.
- [x] Implement reactive automatic watch target selection.
- [x] Add owner/generation-isolated snapshot `useQueries`.
- [x] Reject stale-generation completion and disable offline requests.
- [x] Feed snapshot alerts into `byProfile` presentation state.
- [x] Add deterministic pure fleet summary helpers.
- [x] Keep empty, partial failure, and duplicate-identity cases explicit.

## Success Criteria

- Connected manual, connected auto-connect, and disconnected auto-connect profiles appear; disconnected manual profiles do not.
- Every enabled query key is `['profile', profileId, generation, 'system', 'resource-snapshot']` through the canonical builder.
- One profile can load/fail/reconnect/change generation without removing or poisoning peer entries.
- Offline auto-connect targets make no API request and cannot publish a late old-generation result.
- Duplicate incident IDs remain independent in `byProfile`; fleet unread equals the sum of watched profile buckets.
- Summary never averages metrics and never describes a connection failure as a host-resource incident.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Dynamic `useQueries` result/target misalignment | Wrong host data on a card | Stable configured ordering, one memoized target array, profile-ID assertions in tests. |
| Late generation result | Cross-endpoint stale display | Generation in key plus `isCurrentConnection` completion fence. |
| Alert ID collision | Under-counted fleet badge | Sum `byProfile`; never globally dedupe fleet incidents. |
| N-profile network load | Excess polling | 15s cached snapshot only; no high-frequency metrics in this hook; disconnected rows disabled. |
| Frequent connection notifications | Render churn | Subscribe to primitive signature; memoize projections. |
| Cached data after disconnect | False healthy claim | Connection status outranks health and data is labeled last known. |

## Security Considerations

- Bound owner selects both client and cache key; never resolve through active profile after target derivation.
- Do not log profile URLs, hostnames, alerts, mount paths, or API errors from this hook.
- Treat snapshot strings as untrusted display data; this phase does not create HTML or navigation.
- No credentials/tokens enter query keys, returned entries, alert state, or diagnostics.
- Existing SSE validation and REST reconciliation remain authoritative; do not trust client aggregation for host actions.

## Side-Effect Review Checklist

- [x] No call to `connectProfile`, `disconnectProfile`, profile save/delete, mutation API, or host action.
- [x] Snapshot observers stop when profile leaves scope or hook disables.
- [x] Auto-connect offline profile remains visible but network-silent.
- [x] Query cleanup follows `useQueries`; no custom timer/event bus introduced.
- [x] Profile removal retains other `byProfile` buckets.
- [x] No ambient query key or generation-free fallback added.

## Next steps

Phase 01 implementation and review complete with 58/58 tests passing and build passing. Proceed to Phase 02 (`phase-02-fleet-deck-and-card-components.md`) to build accessible fleet overview cards, status badges, and empty/partial states consuming `MultiHostResourceEntry` and `HostResourceFleetSummary`.
## Unresolved questions

None.