# Phase 01 — Explicit ownership and connection foundation

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: None; freeze contracts before parallel feature implementation.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Runtime and ownership.

### Key Insights

#### Observed constraints

`api/transport.ts` owns one transport and global generation. `api/client.ts` dispatches every API group through it. `api/query-client.ts` hashes using active profile at call time. `WsTransport` already freezes bearer per instance and maintains per-instance FS/write/OPAQUE pending maps, but REST controllers escape destroy and WS reconnect reuses the same instance. `hooks/use-sse.ts` installs one bridge and globally invalidates queries. Preserve these proven transport mechanisms; replace ambient ownership rather than duplicate protocols.

### Requirements

Explicit owner/generation for every remote operation; independent lifecycle and no ambient fallback.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Context and dependency

Depends on none. Foundation owner owns shared API/event modules for all later phases. Read [design-contracts.md](design-contracts.md); it is the normative shared contract within this plan directory. Proposed implementation, not current behavior.

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 01A | `ownership.ts`, key encoding, bound client/transport signatures | G0; Phase 02 credential schema contract | Owner mismatch rejected before dispatch |
| 01B | Registry lifecycle, auth bootstrap, retirement, reconnect | 01A; endpoint-bound profile helpers | One live generation/profile; B survives A failure |
| 01C | Query factories and runtime event bridge | 01A–B | No ambient hash, unqualified remote event or broad invalidation |
| 01D | Complete API/caller migration and singleton removal | Integrated shipped-target callers: 02–07 for web, plus 08 for native | G1 compiler/caller audit; simultaneous startup enabled only now |

01A/01B availability is **not** full Phase 01 completion. Keep factory imports acyclic; registry installs a non-React bridge and owns its disposer. `Transport.invoke` cancellation also reaches response-body parsing and PNG upload, not only the initial fetch. On retirement, mark stale synchronously before asynchronous cleanup. React StrictMode effect remounts must not create duplicate sockets/bridges or clear another profile.


#### Numbered implementation steps

1. Add `packages/ui/src/api/ownership.ts` with exact qualified refs/key helpers in canonical contracts. Keep server wire DTOs separate. Update project-target normalization without stripping profileId; remove string shorthand from frontend callers. Use current `normalizeProjectTargetPath`.
2. Add `packages/ui/src/api/connections.ts`: keyed external store with immutable snapshots, per-profile generation/tombstones, intent, status, captured clients and disposal. Extend successful `GET /api/auth/status` in `server/src/api/auth.rs` with `workbenchProtocol: 2` in normal and dev branches. After bound authentication require exactly 2 before WS/feature requests; missing/different marker makes that profile unsupported with mandatory-upgrade guidance, never fallback. Auth rejection remains login-required; network failure remains offline. Protocol marker does not replace auth or feature-specific availability.
3. Refactor `api/client.ts` into `createApiClient(owner, transport)` with unchanged method groups and explicit `getApi(owner)` lookup. Route project-qualified arguments through an owner-match check and explicit wire target projection. Expose the owner-bound WS filesystem/OPAQUE methods through typed transport capabilities so callers do not cast a global singleton. Existing public API DTOs are unchanged except frontend wrappers.
4. Change `WsTransport` to one socket generation per instance, explicit endpoint/profile/token arguments, tracked REST/PNG AbortControllers, external cancellation and stale completion guards. Move its reconnect schedule/backoff to registry, keeping 1s initial/30s cap. Guard all socket callbacks by captured socket and runtime generation; destroy clears buffer callbacks as well as existing maps and rejects pending promises. No replay queue or mutation retry.
5. Add explicit owner query factories in `api/query-client.ts`; remove ambient hash and replace every query/invalidation in `api/queries.ts`, `api/workflow-queries.ts` and consumers. Preserve query-specific stale times/poll intervals; no ownership-based global polling. Mutation variables capture owner before dialogs/prompts/await. Aggregate reads derive from individual per-profile queries, not one all-or-nothing promise.
6. Refactor `hooks/use-sse.ts`, `hooks/use-sse-events.ts`, `hooks/use-transport-generation.ts`: per-runtime bridge, profile/generation event envelopes and owner-filtered cache effects. Wire registry bridge installation exactly once independent of TopNav/route mounts. Preserve payload validators and incarnation checks. Server workspace/config events affect only their profile; no global terminal incarnation reset.
7. Remove singleton `initTransport`, `reconfigureTransport`, `reinitializeTransport`, global generation, `profileScopedQueryKeyHash`, and their obsolete tests once hosts/callers switch. `transport-utils.ts` retains only explicit per-profile support resolution if useful; otherwise delete the obsolete module. Do not retain runtime compatibility aliases that consult active profile. With zero profiles, mount shell without a fake live transport; remove now-unused duplicate idle transports after confirming no references.
8. Mechanical caller migration spans foundation and feature slices. G0 supplies frozen interfaces. G1-Web requires every shared/web caller in Phases 02–07 migrated; G1-Native also requires Phase 08/native callers. Never enable a target while any of its shipped consumers dispatches ambiently. Remove obsolete singleton exports rather than leave native or web compatibility aliases. Record acceptance per platform; full native completion remains pending until its own gate.

### Todo list

- [ ] A/B clients with identical local IDs route independently; owner mismatch rejects before network I/O.
- [ ] Reconnect, URL/auth/token change, removal and late WS callbacks reject old-generation results/events; B remains untouched.
- [ ] Abort reaches HTTP and PNG network requests; disposing A clears all its pending maps/subscriptions only.
- [ ] Query hash is deterministic from its arguments; no active-profile dependency or bearer in keys.
- [ ] Disconnect emits no terminal kill/remove; no automatic mutation replay, including ambiguous transport failure.
- [ ] All feature clients receive explicit owners; no global query reset remains in connection/navigation paths.

### Success Criteria

Also cover a stale rejected response after body parsing; unmount/remount double subscription; remove/re-add with the same profile ID; abort while parsing a streamed response; one profile exhausting reconnect while another remains interactive.

Phase 01 acceptance checklist and S01/S11; integration typecheck after each target’s complete caller set lands. Test status marker in normal/dev auth, absent/wrong marker before WS, and mandatory-upgrade isolation from healthy peers.

### Risk Assessment

Stale callbacks and indirect singleton callers are the primary risk; integrate every caller before enabling concurrency.

### Security Considerations

Captured endpoint-bound credentials, owner checks and per-generation aborts are mandatory.

### Next steps

#### Verification and security notes

Implementation commands from repository root: `pnpm --filter @dam-hopper/ui build`; focused new `pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/api/ws-transport.test.ts src/hooks/use-sse.test.ts`. Add regressions only for collision/race/failure contracts, not source-text wiring. Live scenario: delay A response, change A endpoint/token and select B, release A response; neither B state nor A replacement runtime accepts it. Credentials stay private to runtime, endpoint-bound in storage, bearer-authenticated over existing allowed origins. URL parse failure is explicit unavailable, never same-origin fallback.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
