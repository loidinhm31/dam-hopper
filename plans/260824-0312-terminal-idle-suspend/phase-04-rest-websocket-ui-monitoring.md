# Phase 04 — Protected Status/Timing API, WebSocket Hint, and Settings UI

## Context links

- [Parent plan](./plan.md)
- [Phase 01 contract](./phase-01-policy-config-security-gate.md)
- [Phase 02 coordinator](./phase-02-pty-fleet-coordinator.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-planned-security-gate-required)
- [API reference](../../docs/api-reference.md)
- [WebSocket/UI scout](./scout/scout-02-websocket-ui-report.md)
- [Backend PTY scout](./scout/scout-01-backend-pty-report.md)

## Overview

- Date: 2026-08-24
- Description: Expose authoritative live status, the sole bounded authenticated timing mutation, reconciliation hints, Settings controls, and read-only host-popover state.
- Priority: P1
- Implementation status: Pending; revised design awaits second validation
- Review status: Pending API, authentication, persistence, UI accessibility, and security review

## Key Insights

- REST status remains authoritative after reconnect, lag, or malformed hints; accepted timing updates must converge through the same revision/cache path.
- Existing auth middleware gives actor identity but treats `--no-auth` as a dev actor. Timing handler therefore needs explicit no-auth denial plus enabled-account verification.
- Existing full-config transport is too broad for host-wide timing authority. Add a dedicated invoke/REST mutation that always submits the complete pair.
- Settings is the control surface. Host-resource popover is live read-only context; it must not import mutation hooks or expose trigger/cancel/override actions.
- Helper handoff conflict is not transient network failure. UI must show the bounded 409 and wait for outcome/resume status before user-initiated retry; no automatic retry.
- Browser-observed terminal output remains UI activity only and cannot arm, cancel, or authorize suspend.

## Requirements

### Functional

- Add protected `GET /api/system/idle-suspend/v1/status` returning immutable authoritative `IdleSuspendStatusV1` with revision, state, enabled, timing-mutable flag/reason, capability code, fleet counts/generation, configured pair and approved bounds, optional arm deadline, last typed outcome, and timestamps.
- Add only `PATCH /api/system/idle-suspend/v1/timing` for browser mutation. Exact complete request/result/error contract is frozen in Phase 1; route body limit is small, JSON-only, same-origin for cookie auth, and denied under `--no-auth`.
- Extract `AuthenticatedActor`, verify configured auth and enabled account, then submit `UpdateTiming` to coordinator. Handler never edits TOML/runtime directly and never invokes helper.
- Return `409 idleSuspendHandoffInProgress` after accepted helper handoff with zero audit/memory/disk mutation. Do not attach retry-after time; status outcome/resume reconciliation is the release signal.
- Preserve/reject `[server.idle_suspend]` through `PUT /api/config`, settings import, workspace reload/switch, and global-config mutations; none may bypass the dedicated endpoint.
- Add bounded `host:idleSuspendChanged { version: 1, revision: integer }` on meaningful revision changes, including accepted timing commit and handoff outcome/resume. It only invalidates/refetches status.
- Isolate hints from terminal output pressure with a small bounded channel/pump. Lag, reconnect, profile change, and mutation success all reconcile through status GET.
- Add a Settings section with two labeled numeric controls and one explicit save action. Initialize from status, enforce advertised bounds client-side, submit both values, disable while pending, mutation-ineligible, or handed-off, and preserve entered values on recoverable errors. Operator-disabled or helper-unavailable execution alone does not remove normal authenticated timing access.
- On accepted changed result, invalidate status and reconcile to returned/status revision; do not optimistically claim an arm/deadline. On same-pair result, keep cache stable.
- On 409, show handoff-in-progress guidance and allow manual retry only after state leaves `handedOff` through outcome/resume reconciliation.
- Add read-only `HostIdleSuspendStatus` inside `HostResourcePopover`, showing disabled/unavailable/watching/armed/handed-off/suppressed/failed/resumed, fleet counts, current pair, and sampled time. No timing inputs or mutation hook there.
- Keep existing per-terminal receiving/quiet indicators unchanged. No trigger, cancel, enable/disable, helper enrollment, keep-awake lease, or wake override UI/API.

### Non-functional

- Status and mutation follow protected-route CORS/auth behavior; status uses `Cache-Control: no-store`. Mutation uses existing closed `{ error, code }` body and no sensitive detail.
- API uses camelCase/versioned path. DTO and event enums are closed; browser runtime validators reject malformed/unknown/oversized shapes.
- Query and mutation retry defaults must not auto-retry 409, 4xx, or ambiguous persistence/audit failures. User action is required after status reconciliation.
- Event/history/audit remain bounded and content-free: no terminal ID/output/command/cwd/env, token, raw actor credential, helper detail, inhibitor identity, path, or stderr.
- Controls have visible labels, units, bounds/help, pending/error/success live regions, keyboard support, and text state independent of color.

## Architecture

- `IdleSuspendStatusV1` comes from coordinator/status store. It is never reconstructed from terminal list, output, browser stores, or helper synchronous calls.
- Timing handler performs transport/auth/DTO validation, then awaits the coordinator command result. The coordinator owns admission ordering, audit, canonical pair persistence, runtime commit, fleet re-evaluation, status revision, and exact failure code.
- REST returns current snapshot; dedicated event channel emits revision-only hints. UI query key `['system', 'idle-suspend', 'v1', 'status']` is authoritative across profiles.
- Settings mutation has `retry: false`; success invalidates/refetches status. A valid newer WS hint also invalidates. Older/equal revisions are harmless; profile change removes prior-server cache before fetch.
- `SettingsIdleSuspendTimingSection` owns form state and mutation. `HostIdleSuspendStatus` receives query data only; popover cannot import or call timing mutation.
- Existing flow remains: PTY output with terminal ID -> per-ID transport listeners -> replay gate/xterm -> local activity. No edge enters coordinator.

## Related code files

| Absolute path | Action | Purpose | Dependencies |
|---|---|---|---|
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/idle_suspend.rs` | Create | Protected status and dedicated timing handlers/errors | Phase 1 DTO; Phase 2 coordinator |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/mod.rs` | Modify | Export idle-suspend API module | New handler |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/router.rs` | Modify | Register GET/PATCH, auth, JSON/origin guard, body cap | New handler |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/config.rs` | Modify | Ensure full config cannot mutate idle-suspend policy/timing | Phase 1 guard |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/settings.rs` | Modify | Ensure import cannot bypass dedicated mutation | Phase 1 guard |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/event_sink.rs` | Modify | Add dedicated bounded revision-hint sender/subscriber | Coordinator status |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/ws.rs` | Modify | Pump hints independently; reconcile on lag | Event sink |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/tests.rs` | Modify | Auth/no-auth, route, contract, preservation, conflict/failure tests | Router/handler |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/api/client.ts` | Modify | Add closed status/timing/result/error types and calls | v1 REST contract |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/api/ws-transport.ts` | Modify | Map status/timing invokes and hint dispatch | Client contract |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/api/ws-transport.test.ts` | Modify | REST mapping, hint, output, reconnect regressions | Transport changes |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/api/queries.ts` | Modify | Add authoritative query and no-retry pair mutation | Client/transport |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/hooks/use-sse.ts` | Modify | Validate revision hint and invalidate status | Query/event contract |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/hooks/use-sse.test.ts` | Modify | Revision, malformed, lag, reconnect, profile tests | Event bridge |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.tsx` | Create | Accessible complete-pair Settings form | Query/mutation |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.test.tsx` | Create | Bounds, pair, auth, 409, retry, cache tests | New component |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/components/pages/SettingsPage.tsx` | Modify | Add idle-suspend timing accordion | Settings component |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` | Create | Accessible read-only live status | Status query |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx` | Create | State/content/no-control tests | New component |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/src/components/organisms/HostResourcePopover.tsx` | Modify | Compose independent read-only idle status | Status component |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/api-reference.md` | Modify | Document exact status/timing/event/auth/error contracts | Final wire shapes |

## Implementation Steps

1. Freeze `IdleSuspendStatusV1`, exact Phase 1 mutation DTO/result/errors, bounds fields, and revision hint. Document state meanings and handoff release semantics.
2. Add handler/route guards: protected status; JSON/origin/body-capped PATCH; explicit no-auth and enabled-account check; no re-auth or role.
3. Adapt PATCH to coordinator `UpdateTiming`; map same-pair, accepted change, 409, audit/persistence/reconciliation failures exactly. Add zero-mutation assertions.
4. Close all alternate config/import/reload mutation paths and add regression tests for enablement, enrollment, and timing preservation/rejection.
5. Add dedicated revision hint sender/pump and lag behavior. Ensure cleanup and output ordering remain unchanged.
6. Add UI types, runtime validator, transport mappings, stable status query, pair mutation with `retry: false`, and profile-aware cache behavior.
7. Implement Settings form using server-advertised bounds. Submit the full pair, preserve edits on errors, handle no-auth/unavailable/handed-off, and wait for reconciliation before manual retry.
8. Implement read-only host-popover status. Assert no input/button/mutation import and clarify managed-PTY scope.
9. Test authenticated/disabled actors, no-auth, exact bodies/codes, both admission winners, cache revisions, missed/malformed hints, reconnect/profile switch, accessibility, and unchanged multi-client output.

## Todo list

- [ ] Freeze status, timing, error, and revision contracts
- [ ] Add protected GET and guarded PATCH routes
- [ ] Map coordinator outcomes and close alternate config paths
- [ ] Add bounded revision hint channel/pump
- [ ] Add client types/query/no-retry mutation
- [ ] Add accessible Settings timing controls
- [ ] Add read-only host-popover status
- [ ] Add REST/WS/UI/auth/cache tests and API docs

## Success Criteria

- Authenticated enabled actor can update only one complete bounded pair; no-auth, disabled actor, malformed input, or alternate config route cannot mutate it.
- Pre-handoff success persists/audits/commits/revises/re-evaluates once. Post-handoff exact 409 performs zero memory/disk mutation and is not auto-retried.
- Accepted timing change reconciles status revision, revision hint, query cache, Settings form, and popover state; missed hints recover via REST.
- Settings exposes timing only. Popover remains read-only and both surfaces expose no trigger/cancel/enable/enroll/lease/override control.
- Existing terminal output remains per-ID broadcast/replay behavior; browser observation never affects coordinator.
- Targeted Rust, Vitest, accessibility, and Chromium tests pass.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Full config/import bypasses narrow authority | Critical | Preserve/reject guards plus negative route tests |
| UI auto-retries during handoff | Critical | Mutation `retry: false`; exact 409; state-gated manual retry |
| Cache shows old timing/state | High | Shared revision, success invalidation, hint invalidation, reconnect/profile refetch |
| Popover gains accidental control | Critical | Read-only component boundary; no mutation hook; interaction tests |
| Status/audit leaks host or actor details | High | Closed DTO/audit; no actor in status; capped typed codes only |
| Missed hint appears authoritative | High | REST snapshot authority and no-store |

## Security Considerations

- Protected middleware alone is insufficient: PATCH explicitly rejects `--no-auth`, missing DB auth, and disabled subjects. No role or password flow is added.
- Cookie-auth PATCH requires same-origin JSON; unknown fields and oversized bodies fail before coordinator admission.
- Response/event/status exclude actor, tokens, registry/audit/helper paths, peer identity, raw inhibitor/error data, terminal IDs/content, and request IDs not needed by UI.
- UI wording says managed PTY fleet, not whole-host idleness. Existing output activity is rendering data only.
- Timing controls cannot select helper action inputs; `wakeAfterSeconds` is policy timing persisted before an epoch, never a per-request override.

## Next steps

- Combine config/coordinator/helper/status/Settings flows and gather release evidence in [Phase 05](./phase-05-integration-release-rollback.md).

## Unresolved questions

- Exact quiet/wake defaults/min/max advertised to UI; retain proposed wake `600s`?
- Final status visibility duration for resumed/failed while preserving epoch latch?
