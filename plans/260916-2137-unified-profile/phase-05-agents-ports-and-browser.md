# Phase 05 — Agent tools, ports, Browser and capability isolation

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01–02 and TerminalInstanceRef contract.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Agents and Browser.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Owner-stable catalogs, imports, ports, Browser target and same-owner incarnation-safe handoff.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependencies, evidence and files

Consumes Phase 01/02 and TerminalInstanceRef contract from Phase 04 (implementation may proceed concurrently). Files: `components/pages/AgentStorePage.tsx`; StoreInventory, ItemDetail, DistributionMatrix, ShipDialog, HealthStatus, ImportDialog, MemoryEditor; `hooks/use-ports.ts`, `use-tunnels.ts`, `use-browser-debug.ts`, `use-browser-capture.ts`; PortsPanel, BrowserDebugPanel/CaptureControls/TerminalHandoff/IframeHost/KeepAliveHost, terminal runtime navigator components; `lib/browser-debug-origin.ts`, `browser-debug-host.ts`, `browser-terminal-handoff.ts`, `browser-debug-address-history.ts`, `browser-capture.ts`; `hooks/use-feature-flag.ts`. Foundation owner updates API/query groups; shell owner integrates WorkspacePage. Native Browser adapter work belongs to Phase 08.

Observed: agent item/matrix/project and import temporary paths are unqualified; memory editor defaults to first project. Ports merge by numeric port, tunnel callbacks omit owner. Browser hook has one target resolved against ambient tunnels; delayed create/upload/handoff can observe new focus. Bridge already validates exact origin/source/nonce/request IDs and bounded messages. Health endpoint reports only schema/status/version/role, not feature capabilities; `useFeatureFlag` is a placeholder returning true.

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 05A | Explicit agent catalog/import/draft ownership | G0 API/target refs | No cross-server tmpDir or distribution |
| 05B | Qualified port/tunnel rows and capability state | G0 events; profile support resolver | Equal ports independent; unknown/unavailable distinct |
| 05C | Browser target revision and one physical surface lease | 05B; G0 Browser contract | Focus preserves target; explicit target change destroys trust |
| 05D | Server incarnation-aware create/handoff plus frontend pipeline | G0 TerminalInstanceRef; Phase 07 cleanup contract | Atomic admission rejects replacement PTY, no ID fallback |

05D backend can begin independently of Browser UI after G0. Integration order: server captures/returns incarnation → frontend requires acknowledgement → enable handoff. Missing response acknowledgement after protocol admission is an incompatible-server error; retire that runtime, never fall back or continue partial old-contract use. Keep exact actor/origin/bridge restrictions; no profile routing in page messages.


#### Numbered implementation

1. Agent Store gets an explicit profile selector independent of project focus (initialise from selected project only when opening a new page context, never retarget an existing operation). Inventory, content, scan, health, category/item keys and distribution matrices remain server-local under that owner. Ship/unship/absorb/bulk ship accepts only projects from the item's owner. Do not invent cross-server distribution or merge same-named catalogs; mixed-owner target selection is invalid. Report per-target failures and refresh only the originating owner.
2. Import scan/confirm holds `{ConnectionRef, tmpDir, scanRevision}` from initiation. Repo URLs/local directory paths are evaluated by that server, not browser machine. Changing displayed profile parks/cancels the old dialog; no confirm can send A's tmpDir to B. Preserve existing server cleanup/retention semantics; do not invent an API to delete arbitrary paths. Memory/templates/apply/preview/save retain explicit owner/project/agent and dirty draft identity; arriving data for B cannot replace an A draft. Template preview is not a save.
3. Aggregate ports/tunnels by owner: detected-port identity `(profileId, port, terminalId, incarnation)` and tunnel `(profileId, tunnelId)`; distinct equal numeric ports get distinct rows. Reuse server-local numeric-port detection, owner rechecks and tunnel installation/platform constraints. Start/stop/install/kill session/open URL callbacks capture origin owner; manual ownerless tunnels still require an explicit profile. Event updates/invalidation affect only their profile generation. Local-server/address decisions take that profile's URL explicitly, not active state.
4. Browser selection is an explicit target `{owner: ConnectionRef, url, origin, source, tunnelId?}`. Keep logical target/address history/selection state partitioned by profile, but one visible physical iframe/native child lease. Selecting a project alone does not switch Browser target or destroy it. Explicit Browser target change destroys old trust/nonce/pending commands and capture streams before activating new target; a parked target requires a new handshake on resumption. Target/tunnel loss from B cannot invalidate active A. Preserve exact tunnel-origin/loopback/redirect and credential-free URL policy.
5. Terminal handoff choices include profile/project/worktree/session/incarnation. Only same-profile live terminal instances may receive the target's artifact; cross-owner handoff is rejected before create. Capture operation snapshots owner, Browser target revision and TerminalInstanceRef through selection → create → PNG upload → handoff. Check all three after every await. Stale artifacts are deleted through a narrow original-endpoint cleanup handle (Phase 07), not a newly resolved client. Stop stale screen streams immediately; keep existing secure-context, browser-surface, PNG byte/pixel bounds.
6. Keep profile IDs, server URLs, bearer tokens and routing decisions outside page/extension bridge messages. No generic native IPC is exposed. Existing exact schema, source/origin/nonce/request/generation checks and console redaction remain. Browser presentation viewport preference may stay device-global; selectable address history is owner-scoped and continues stripping query/hash. External page URLs never choose an API connection.
7. Fix the evidenced server artifact race: `server/src/api/browser_debug.rs:28–118` checks raw terminal ID at create and handoff; `server/src/browser_debug/store.rs` stores raw ID; `server/src/pty/manager.rs` has incarnation-bearing live sessions. Require `terminalIncarnation` in artifact create; missing/invalid field fails existing request validation, and no old-client omission branch remains. Resolve concrete live incarnation on create, reject supplied mismatch (409 with existing structured API error shape), and persist authoritative incarnation in in-memory artifact metadata. Add PTY `write_if_incarnation(id, incarnation, bytes)` using the same locked/live-session write path as current write so lookup/check/write admission cannot target a replacement session. Handoff uses stored incarnation, releases handoff claim on failure, never falls back to ID-only. Add response `terminalIncarnation`; frontend rejects missing/mismatched acknowledgement before upload/handoff; a protocol-2 server returning the old shape is treated as incompatible and its runtime retired. Preserve TTL, one-upload/one-handoff, private temp storage, payload bounds and no artifact read/list endpoint. No database migration or frontend profileId is sent. Preserve existing shared-server authorization rather than claiming profiles are actor-isolated tenants.

   Extend artifact metadata/response/error definitions in `server/src/browser_debug/mod.rs` and `store.rs`, frontend DTO in `api/client.ts`, and existing API error mapping for an incarnation conflict. The PTY helper must preserve current handoff/closing/disposing/input-revision guards and rollback-on-write-failure from `PtySessionManager::write`, not introduce a weaker second write path.
8. Feature availability is owner-local, derived from existing profile support status, server config features, endpoint-specific 404/structured unavailable responses and capability-bearing host/usage/Browser results. Replace placeholder-only gating where used; do not infer support from another profile or version string. Public health success is not authentication or feature support. Use explicit states unknown/loading/available/unavailable with reason; reconnect refetches. Distinguish auth/network/unsupported/target-unavailable from empty data. Do not add a broad capability API. The status protocol marker is a mandatory admission floor, not feature discovery; media v2 and artifact incarnation remain required response contracts.

### Todo list

- [ ] Equal agent item/project names and temporary scan paths never cross servers; owner switch cannot save/import a stale draft into B.
- [ ] A/B identical port numbers and terminal IDs remain distinct; tunnel operations and Browser target resolution stay owner-bound.
- [ ] Project selection leaves Browser target unchanged; explicit target change invalidates capture/bridge state safely.
- [ ] Same-owner-only handoff and server-side incarnation check reject a reused terminal ID race without writing to replacement PTY.
- [ ] Offline/unsupported Browser/workflow/usage/host feature on A does not disable B or display B's cached data as A's.

### Success Criteria

Backend race proof must observe replacement PTY input bytes **and input revision** unchanged. Test create mismatch before persistence, handoff-claim release after write failure, and missing create incarnation rejected before persistence. New frontend rejects old server at status protocol admission before WS or feature dispatch; missing acknowledgement after admission prevents PNG upload/handoff.

Phase 05 checklist and S06/S08/S11.

### Risk Assessment

DOM or delayed capture must not select routing; old raw terminal ID can refer to a replacement PTY.

### Security Considerations

Preserve bridge origin/source/nonce checks, PNG bounds and server authorization; atomic incarnation write required.

### Next steps

#### Verification and risks

Live S06/S08 plus existing agent/ports/Browser/handoff/capture/origin tests. Extend `server/tests/browser_debug_artifacts.rs` with create on incarnation N, replace same ID with N+1, handoff denied and N+1 input unchanged; include a race at write admission, not merely two separate is_alive calls. Run bridge/extension security regressions unchanged where possible. No expansion of pre-existing tunnel-port safety policy or cross-actor tenancy in this refactor; document duplicate-profile shared authority and preserve current server permission checks.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
