# Phase 03 — Frontend Transport and Data Provider

## Context Links

- [Plan/preflight](./plan.md); [current progress](./progress.md); [Phase 01 DTO/API](./phase-01-server-policy-update.md); [Phase 02 catalog/API](./phase-02-server-harness-model-discovery.md); [Phase 04 consumers](./phase-04-frontend-ui-inline-card-editor.md).
- [Scout transport findings](../reports/scout-261003-1822-advisor-routing-model-selector.md#2-frontend-data-provider-and-client-transport).
- [Native ownership architecture](../../docs/architecture/native-advisor.md#native-ownership-and-dataflow), [provider](../../packages/ui/src/advisor/native-advisor-provider.ts), [client](../../packages/ui/src/api/client.ts), [REST mapping](../../packages/ui/src/api/ws-transport.ts).

## Overview

- Date: 2026-10-03. Priority: P2. Status: completed (tested & reviewed); captured statuses historical. Effort: 4h.
- Extend the existing native, owner-bound Advisor transport. No new fetch client, plugin bridge, WS server mutation handler, or global catalog cache.

## Key Insights

- `createApiClient().advisor` implementation and `ApiClient.advisor` interface are separate sections in `client.ts`; update both and DTO import/re-export lists.
- `channelToEndpoint` maps Advisor channels to REST in `ws-transport.ts`. File name does not imply new server websocket protocol is necessary.
- `AdvisorDataProvider` currently has eight read/history/evaluation operations; `NativeAdvisorProvider` supplies request-ID cancellation via `activeControllers`, `createRequestController`, `checkAborted`, `mapError`, `cancel`, and `destroy`.
- Provider captures `ApiClient`/`ConnectionRef`; request calls must never re-read global active profile or Settings target.
- `ApiRequestError` exposes `status`, `code`, and `details`. Current `mapError` relies largely on message regex and would obscure typed policy errors/conflict; preserve structured fields for new routes.
- Empty capabilities are permissive for the existing read card, but must never implicitly authorize a new write button.

## Requirements

1. Add exact camelCase wire types shared by client/provider/UI; backend is union `'omp' | 'codex' | 'claude' | 'pi'`, models remain strings for custom identifiers.
2. `updatePolicy(requestId, params)` and `listModels(requestId, backend)` return phase-defined authoritative DTOs, not synthetic success or local fallback data.
3. Pass `AbortSignal` through `TransportInvokeOptions`, reject after await if aborted/destroyed, and always clean request bookkeeping.
4. Advertise `policy.update` and `models.list` explicitly only through the native supported operations. Do not equate catalog CLI availability with catalog endpoint permission; fallback still works when harness is absent.
5. Decouple new routing capabilities from `status.available`, which reports history-directory availability, not policy/model endpoint support. After an enabled/admin-authorized status probe, retain `policy.readCurrent`, `policy.update`, and `models.list` even with missing history; keep history capabilities/source flags unavailable. A failed auth/disabled/revoked context must not retain write capability. Do not otherwise redefine history availability or pretend a missing policy file exists; its read status decides editability. Server auth remains authoritative.
6. Stable `AdvisorErrorCode` additions for write validation/conflict/unsafe/not-editable/write failure; preserve HTTP status and machine code from `ApiRequestError`.

## Architecture

| Provider operation | Client operation | Transport channel | REST mapping | Result |
|---|---|---|---|---|
| `updatePolicy(id, params)` | `advisor.updatePolicy(params, options)` | `advisor:policy:update` | `PATCH /api/advisor/policy`, body `params` | `PolicyReadCurrentResultDto` |
| `listModels(id, backend)` | `advisor.listModels({backend}, options)` | `advisor:models:list` | `POST /api/advisor/models`, body `{backend}` | `AdvisorModelsResultDto` |

Proposed TypeScript contracts:

```ts
export type AdvisorBackend = 'omp' | 'codex' | 'claude' | 'pi';
export interface PolicyUpdateParamsDto {
  readonly expectedRevision: string;
  readonly advisor: {
    readonly primary: AdvisorRouteTarget;
    readonly backup: AdvisorRouteTarget;
  };
}
export interface AdvisorModelsParamsDto { readonly backend: AdvisorBackend; }
export interface AdvisorModelOptionDto {
  readonly id: string;
  readonly label: string;
  readonly efforts: readonly string[];
}
export interface AdvisorModelsResultDto {
  readonly backend: AdvisorBackend;
  readonly source: 'harness' | 'fallback';
  readonly models: readonly AdvisorModelOptionDto[];
  readonly efforts: readonly string[];
  readonly defaultEffort: string;
  readonly observedAt: number;
  readonly issueCode?: string | null;
}
```

- `AdvisorModelOptionDto.efforts` is model-specific when discovered; response `efforts` supplies backend defaults for custom models. Effort values come from producer-compatible server rules, not a UI-invented global scale.
- Reuse `PolicyReadCurrentResultDto` as update result; no redundant `PolicyUpdateResultDto` alias or second policy shape. Request routes can reuse `AdvisorRouteTarget` without narrowing historical route fields across the whole app.

## Related Code Files

| Action | Repository path | Change |
|---|---|---|
| Modify | `packages/ui/src/advisor/advisor-types.ts` | Backend/catalog/update DTOs, typed policy errors |
| Modify | `packages/ui/src/advisor/advisor-data-provider.ts` | Required `updatePolicy`/`listModels` methods |
| Modify | `packages/ui/src/advisor/native-advisor-provider.ts` | Capabilities, abortable methods, structured error conversion |
| Modify | `packages/ui/src/api/client.ts` | DTO imports/exports, client implementation and interface |
| Modify | `packages/ui/src/api/ws-transport.ts` | Two `channelToEndpoint` REST cases |
| Modify | `packages/ui/src/api/ws-transport.test.ts` | Exact endpoint/verb/body, owner/auth/signal error assertions |
| Modify | `packages/ui/src/advisor/native-advisor-provider.test.ts` | DTO forwarding, errors/cancel/destroy/late results |
| Modify | `packages/ui/src/advisor/AdvisorPanel.test.tsx` and other discovered provider doubles | Migrate every `AdvisorDataProvider` implementation/fake to required methods |
| Intentionally unchanged | `packages/ui/src/advisor/index.ts` | Change only if its current export scheme requires explicit new symbols |
| Delete | None | No compatibility aliases or optional-method shims |

## Implementation Steps

1. Confirm Phase 01/02 Rust DTO names, wire field casing, issue codes, model identity formats, and efforts. Encode those contracts once in `advisor-types.ts`. Keep persisted snake_case out of frontend write requests.
2. Extend `AdvisorDataProvider` with required methods:
   - `updatePolicy(requestId: string, params: PolicyUpdateParamsDto): Promise<PolicyReadCurrentResultDto>`.
   - `listModels(requestId: string, backend: AdvisorBackend): Promise<AdvisorModelsResultDto>`.
3. Add both typed operations to the returned client object and public `ApiClient.advisor` interface. Forward options unchanged to `transport.invoke`, preserving captured-owner routing and signal.
4. Add channel switch cases with exact phase-selected HTTP paths/verbs/bodies. Do not silently change `/policy/current`, rely on raw `fetch`, or introduce GET query interpolation for backend values.
5. Add native capabilities and provider methods following `readCurrentPolicy`: create controller, check abort, call client with signal, check abort after await, return real response, map errors, release controller.
6. Ensure same-ID supersession cleanup cannot delete a newer controller: only remove the map entry in `finally` when it still equals the local controller. Apply this small shared-helper fix to all provider operations that use the same bookkeeping; it is necessary for new cancellation races, not a second convention.
7. Extend error mapping with an `ApiRequestError` structured-code/status branch before regex fallback. Preserve the phase-defined policy code set, 409 conflict, auth/disabled semantics, and abort precedence. Never expose arbitrary raw `details` or credentials in user messages.
8. Search all `AdvisorDataProvider` object literals/implementations/test doubles; migrate all callers, no optional-method probes or fabricated no-op methods. Native provider is the production implementation; mocks remain tests only.
9. Add focused transport/provider tests without executing them mid-flight. Examples: custom model/expectedRevision payload unchanged; backend-only catalog body; no current Settings profile lookup; signal forwarded; `ROUTE_BACKUP_IDENTICAL`/409 survive conversion; cancellation and destroy suppress late completions; identical IDs do not lose newer abort handle.

## Todo List

- [x] Shared wire types and stable error union.
- [x] Required provider methods and native capabilities.
- [x] Typed client implementation/interface and REST mappings.
- [x] Structured error preservation and race-safe controller cleanup.
- [x] All affected provider doubles migrated; focused tests authored.

## Success Criteria

- Exact PATCH/POST URLs, serialized camelCase bodies, credentials and abort signal observed in transport tests; no mutation sent as a WS frame.
- Native provider forwards both operations to the captured owner; success returns server data unmodified.
- HTTP 409 and route validation codes reach editor unchanged; cancelled/destroyed work becomes `ABORTED`, not a false success.
- Same-ID cancellation/supersession cannot clear newer request bookkeeping; destroy aborts all remaining operations.
- Enabled admin with valid policy but no history directory still receives routing/model capabilities and can edit; unavailable history behavior remains unchanged.
- UI package typecheck resolves all interface callers; no `any`, optional shim, duplicate DTO, or client-only model fallback.

## Risk Assessment

- **Two client definitions drift:** update implementation, interface, imports/exports together; exact mapping tests.
- **Regex error hiding:** structured API error handling first; retain legacy fallback only for existing unrelated errors.
- **Owner switching:** provider/client captured at dispatch and post-await fenced; parent remains responsible for current context publication.
- **Abort != rollback:** provider cancellation affects response publication, not already-committed policy disk writes; reread on uncertain mutation failure.

## Security Considerations

- Backend is a closed value, not executable/argv/path input. Model strings are data and never interpolated into transport URLs or HTML.
- Capability checks are UI affordances, never authorization. Maintain current REST session/admin middleware on server.
- No unscoped cache, credential catalog fields, raw CLI output in browser, or background auto-retry of policy mutation.

## Next Steps

Phase 04 consumes the two required methods through panel callbacks; Phase 05 executes `pnpm --filter @dam-hopper/ui test src/advisor/native-advisor-provider.test.ts src/api/ws-transport.test.ts` and `pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json`. Commands specified, not run by planner.

### Phase 03 Completion Notes

- Implementation verified with 100% Vitest pass (69/69 focused tests across 3 files, 2,259/2,259 full suite across 297 files).
- TypeScript check (`pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json`) passed with 0 errors.
- Code review completed (Score: 9.8/10); report recorded at `plans/reports/code-review-261004-0105-phase-03-frontend-transport-data-provider.md`.

## Unresolved Questions

None requiring user input.
