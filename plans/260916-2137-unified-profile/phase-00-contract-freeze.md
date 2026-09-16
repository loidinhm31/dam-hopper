# Phase 00 — Scope, inventory and contract freeze

## Context links

[Confirmed validation decisions](validation-decisions.md).

[Plan](plan.md) · [Design contracts](design-contracts.md) · [Execution map](execution-map.md) · [Coverage](coverage-and-decisions.md) · [Source preplan](../reports/preplan-260916-2135-unified-profile.md) · [System architecture](../../docs/system-architecture.md#proposed-unified-profile-workbench-2026-09-16-not-implemented)

## Overview

Date: 2026-09-16. Priority: P1. Phase 00 documentation: complete (100%; G0 baseline frozen). Runtime implementation: none; runtime qualification: pending future phases. Owner: foundation/integration lead. Dependency: none. Deliverable: G0 contract baseline and complete caller inventory documented in [inventory-and-contract-freeze.md](inventory-and-contract-freeze.md).

## Key Insights

- Current `packages/ui/src/api/transport.ts` exports a singleton and one global generation. `api/query-client.ts` hashes with ambient active profile. Several transports alone cannot isolate operations.
- The input already specifies nine implementation phases. Preserve their numbering and scope; introduce this preparation gate to remove the circular interpretation of “Phase 01 complete before migrating callers”.
- `docs/system-architecture.md` also contains a separate backend-workspace proposal. This request explicitly does **not** introduce its server workspace UUIDs, catalog, protocol rewrite or terminal database migration.
- Current LSP status: no configured server. Recheck at implementation start; use references if available, otherwise scoped searches plus the integrated compiler gate.

## Requirements

1. Freeze ownership, API, event, lifecycle, storage and compatibility contracts before independent slices edit callers.
2. Inventory remote authority, including indirect callbacks, imports, timers, React cleanup, login/test requests, WebCrypto, streaming and native IPC.
3. Assign one writer to shared files. No ambient compatibility shim. Release independently per qualified platform; no partially migrated target ships.
4. Establish safe qualification prerequisites without touching real credentials/configuration or launching privileged actions.

## Architecture

Three distinct gates:

- **G0 / contract freeze:** agreed signatures, identity encodings, error semantics, wire compatibility and ownership map. Feature slices may begin after this gate.
- **G1 / integrated ownership:** G1-Web accepts shared/web callers and Phases 01–07; G1-Native additionally accepts Phase 08 and native bootstrap/IPC. Simultaneous startup is enabled only for a target whose complete shipped caller set has migrated.
- **G2 / release qualification:** G2-Web requires S01–S12 and applicable browser-host restrictions; G2-Native additionally requires target-native S13/common scenario proof. Windows blockage holds native, not an independently qualified web release.

A feature can be locally developed after G0 without claiming G1. Contract-only exports may be temporarily unused during development; never ship implementations that dispatch through the old active profile.

## Related code files

Paths are repository-root-relative.

| Action | Files | Purpose |
|---|---|---|
| Inspect; modification owned by Phase 01 | `packages/ui/src/api/{transport,client,queries,workflow-queries,query-client,ws-transport}.ts` | Callers, channels, DTO projection, asynchronous fences |
| Inspect; modification owned by Phase 02 | `packages/ui/src/api/server-config.ts`, `packages/ui/src/embed/dam-hopper-app.tsx`, `apps/web/src/main.tsx`, `apps/native/src/main.tsx` | Profile/auth migration and startup |
| Inspect; inventory by feature owner | `packages/ui/src/hooks/`, `packages/ui/src/stores/`, `packages/ui/src/contexts/`, `packages/ui/src/lib/`, `packages/ui/src/components/` | Hidden ownerless resource state and effects |
| Inspect | `server/src/api/{auth,browser_debug,fs_image,fs_video,media_session}.rs`, `server/src/pty/manager.rs` | Existing authorization and mandatory protocol cutover |
| Inspect | `apps/native/src-tauri/src/ssh_forward/`, `packages/ui/src/lib/ssh-forward-host.ts` | Scope admission, epochs, shared wire contract |
| Maintain during implementation | Plan coverage/evidence ledger | Track callers and observable acceptance, not source-text tests |

Do not create new runtime files in Phase 00; `ownership.ts` and `connections.ts` belong to Phase 01.

## Implementation Steps

1. Reconcile current branch/source with this plan. Preserve unrelated work. Record source drift that changes a contract before editing callers; do not silently import the other workspace design.
2. Inventory every singleton transport/API import; default auth/server-URL helper; direct network constructor; query/invalidation; event subscriber; persisted resource store; terminal raw-ID map; native scope command. Record `file → symbol → owner source → async boundary → phase owner → acceptance scenario`.
3. Distinguish local presentation preferences from server-local resource identifiers. Inventory exact old resource key/version families for reset and new-schema records to preserve; do not add resource recovery machinery.
4. Freeze `ConnectionRef`, project/terminal refs, normalized tuple keys, immutable snapshot rules, typed stale/unavailable/owner-mismatch errors, API factory and transport cancellation/disposal. Snapshot generation checks must also reject failed responses after parsing, not only successful responses.
5. Freeze per-profile query prefixes, event envelopes and the non-React runtime bridge installer. Hooks subscribe to the bridge; registry startup must not call React hooks. Avoid a runtime import cycle between registry, client factory and transport interfaces.
6. Freeze profile edit/login completion revision checks and endpoint-bound credential conversion separately from fresh browser resource reset. Enumerate old resource key/version families to discard; no archive/quarantine/restore UI. Valid new-schema records, profiles, native vault/trust and server resources remain untouched.
7. Freeze `RemoteCleanupHandle` as exact-resource, bounded, original-endpoint cleanup only. Resolve issuance/retirement ordering before Browser/media consumers implement it. No general API escape hatch after retirement.
8. Freeze authenticated `workbenchProtocol: 2` admission, required mediaClientId and terminalIncarnation fields, atomic PTY write admission and NativeScopeRef/open-close-reconcile. Remove old media/artifact compatibility paths; preserve ordinary authorization and platform permissions.
9. Assign shared-file owners from the execution map. Feature branches communicate required API/prop changes; integration owner serializes edits. Parallel work may begin now against G0 interfaces; no project-wide validation while shared files are mid-edit.
10. Preflight future qualification: disposable two-server roots/DBs, real-auth MongoDB, Chromium media permissions/cookie controls, Windows device/runner and disposable SSH endpoints. Record missing prerequisites before implementation; no runtime qualification is claimed by this planning deliverable.

## Todo list

- [x] Caller/storage/native inventory assigned to phases and acceptance scenarios.
- [x] Runtime, query/event, migration and cleanup contracts frozen.
- [x] Media/artifact/native wire contracts agreed by producer and consumer owners.
- [x] Shared-file writers and integration gates recorded.
- [x] Qualification prerequisites and blocked platform gates recorded.

## Success Criteria

G0 is complete when every implementation slice can identify its owner inputs, output contracts, shared-file writer, dependency and observable acceptance gate. “Compiles independently” is not required of a deliberately in-progress cross-file cutover; “can dispatch using ambient authority” is never an accepted implementation strategy.

## Risk Assessment

- Main risk: treating interface availability as Phase 01 acceptance. Keep G0/G1 separate in status reporting.
- Existing source changes may invalidate line numbers. Symbols and verified current code are authoritative.
- Missing inventory entries create silent cross-profile routing despite a successful basic demo. Inspect deferred actions explicitly.

## Security Considerations

No tokens in inventory/evidence. No dev `.env`, profile stores or native vaults copied into fixtures. Do not weaken origin, actor, sandbox, incarnation or native admission checks to simplify migration.

## Review and Status

- Phase 00 deliverable (G0 contract freeze & caller inventory) verified and approved across 2 review cycles.
- Cycle 1 review report: [plans/reports/code-review-260916-2328-phase-00-contract-freeze.md](../reports/code-review-260916-2328-phase-00-contract-freeze.md) (Score: 9.6/10).
- Cycle 2 review report: [plans/reports/code-review-260916-2356-phase-00-contract-freeze-cycle2.md](../reports/code-review-260916-2356-phase-00-contract-freeze-cycle2.md) (Score: 9.9/10).
- Final G0 Status: Approved & Frozen. Baseline review evidence records 3,090/3,090 tests (1,412 Cargo + 1,678 Vitest); these are prior review evidence, not Phase 00 runtime validation.

## Next steps

1. Start Phase 01 (`ownership.ts` canonical types, connection registry, bound API/transport, query key builders) and Phase 02 (`server-config.ts` endpoint-bound auth helpers, shell/profile controls) under foundation/shell writers.
2. Align query key prefix convention across all slices: strictly enforce `['profile', owner.profileId, owner.generation, ...]` tuple format.
3. Slices 03–08 proceed in parallel against frozen G0 interfaces without waiting for Phase 01 full acceptance.
4. Track G1 cutover per platform target (G1-Web for Phases 01–07, G1-Native adding Phase 08).

Unresolved questions: none for product scope. Runtime access and source drift are execution prerequisites to record at kickoff.
