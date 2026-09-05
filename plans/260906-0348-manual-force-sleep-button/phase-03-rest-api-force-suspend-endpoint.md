# Phase 03 — REST API Force-Suspend Endpoint

## Context Links

- [Parent plan](./plan.md)
- [Phase 01 protocol/helper semantics](./phase-01-protocol-and-helper-indefinite-sleep.md)
- [Phase 02 coordinator/forced handoff](./phase-02-coordinator-and-fleet-forced-handoff.md)
- [API reference](../../docs/api-reference.md#terminal-idle-suspend)
- [Authentication requirements](../../docs/project-overview-pdr.md#pr-006-rest-api--authentication)
- [Existing protected status/timing phase](../260824-0312-terminal-idle-suspend/phase-04-rest-websocket-ui-monitoring.md)

## Overview

- Date: 2026-09-06
- Priority: P1
- Status: Pending
- Effort: 6h
- Description: Add `POST /api/system/idle-suspend/v1/force-suspend` as a strict authenticated adapter to the coordinator, with cookie same-origin enforcement, enabled-account verification, body limits, closed errors, and server-enforced active-fleet confirmation.

## Key Insights

- The route belongs under the existing protected Axum router, so `require_auth` remains the first authentication boundary.
- Middleware authentication alone is insufficient: current timing mutation explicitly denies `--no-auth`, missing database auth, and disabled subjects. Force suspend must reuse the same production actor gate.
- Same-origin is required only when the request uses the HttpOnly session cookie. Bearer clients are not browser-CSRF capable but still require a valid enabled subject.
- UI confirmation is not authorization. The server must compare `force` against the authoritative fleet snapshot and return current counts on conflict.
- The accepted response means audited handoff admission, not proof that the host slept or resumed. Status and audit carry the eventual outcome.

## Requirements

### Functional

- Register `POST /api/system/idle-suspend/v1/force-suspend` under protected routes with a 16 KiB request limit.
- Require `Content-Type: application/json`; reject malformed JSON, unknown fields, missing fields, duplicate/ambiguous data, non-boolean `force`, and invalid wake values.
- Request DTO: `{ "wakeAfterSeconds": 0 | 60..86400, "force": boolean }`.
- Deny `--no-auth`, missing database authentication, absent/expired actor, and disabled actor before coordinator admission.
- For cookie-authenticated requests, accept exactly one parseable `Origin` and one `Host`, and require `Origin == http(s)://Host`; reject missing, malformed, duplicate, foreign, or userinfo-bearing values.
- Submit only bounded actor subject, wake seconds, and force flag to the coordinator. Never call the helper or fleet claim directly from the handler.
- Return `202 Accepted` with `{ version, requestId, statusRevision, state: "handedOff", wakeAfterSeconds, forced, fleetSnapshot }` after accepted handoff.
- Return `409 idleSuspendActiveFleetConfirmationRequired` with `activeSessionCount` and content-free fleet breakdown when force is required.
- Return `409 idleSuspendFleetChanged` when the reviewed generation changes before claim; include latest content-free counts so UI can require another explicit confirmation.
- Return `409 idleSuspendHandoffInProgress` for any automatic/manual handoff already active.
- Return closed `400/401/403/415/503` codes for validation, auth, origin, media type, coordinator, audit, capability, or shutdown failures.
- Use `Cache-Control: no-store` on accepted and error responses. Do not auto-retry or emit `Retry-After`.

### Non-functional

- DTOs use camelCase, `deny_unknown_fields`, integer-safe bounds, and a versioned closed response.
- Error text is stable and sanitized. Do not return helper stderr, peer data, audit/config paths, inhibitor identities, terminal IDs, commands, or credentials.
- Handler does no host mutation, filesystem write, audit write, or PTY lock access; coordinator owns all side-effect ordering.
- Route remains permanently compiled/registered in production. Availability depends on real auth and enrolled capability, not a browser/dev flag.
- Request handling remains bounded in memory/time and produces at most one coordinator command.

## Architecture

```text
POST /api/system/idle-suspend/v1/force-suspend
  -> protected require_auth middleware
  -> JSON + 16 KiB + cookie same-origin
  -> reject --no-auth / missing DB / disabled actor
  -> strict ForceSuspendRequest validation
  -> coordinator.force_suspend(actor, wake, force)
  -> 202 accepted OR closed 4xx/5xx mapping
```

Recommended response/error types live with the idle-suspend protocol DTOs so Rust tests and TypeScript mirrors share one explicit contract. Keep transport concerns in `api/idle_suspend.rs`; keep claim/audit/execution concerns in the coordinator.

## Preflight Contract

1. The protected router validates the presented session/bearer credential.
2. Handler validates JSON media type and the 16 KiB transport bound.
3. Cookie requests pass exact same-origin verification before body admission.
4. `no_auth == false`, database auth exists, actor extension exists, and actor is still enabled.
5. DTO has exactly required fields and execution-specific wake domain.
6. Coordinator returns an accepted or typed fail-closed result. Handler performs a total mapping with no generic internal detail.

## Related Code Files

| Path | Action | Purpose |
|---|---|---|
| `server/src/idle_suspend/protocol.rs` | Modify | Add strict request/accepted-response DTOs and closed error codes |
| `server/src/api/idle_suspend.rs` | Modify | Add handler; reuse actor/origin/JSON guards and map coordinator results |
| `server/src/api/router.rs` | Modify | Register protected body-capped POST route |
| `server/src/idle_suspend/mod.rs` | Modify | Export API DTOs and force result types |
| `server/src/api/tests.rs` | Modify | Cover router/middleware/auth/origin/body-limit behavior if conventions place route tests here |
| `server/tests/idle_suspend.rs` | Modify | End-to-end protected endpoint and coordinator side-effect assertions |

## Implementation Steps

1. Define `ForceSuspendRequest` and `ForceSuspendAcceptedResponse`; require both request fields and deny unknown fields.
2. Extend `IdleSuspendErrorCode` with manual-action-specific codes. Keep the existing `{ error, code }` base and add count fields only to fleet conflicts.
3. Extract and harden a shared idle-suspend enabled-actor/cookie-origin guard so timing and force handlers cannot drift; add explicit duplicate-header rejection.
4. Implement the handler guard order. Avoid parsing or logging the body before auth/origin gates where framework ordering permits.
5. Validate wake seconds with Phase 01’s execution validator, not `validate_timing_pair`.
6. Await only coordinator admission reply. Map accepted to 202 and every closed coordinator result to the specified HTTP/code/body.
7. Add the route under `protected`, with `RequestBodyLimitLayer::new(16 * 1024)` and no alternate WebSocket/native bypass.
8. Add tests for valid cookie and bearer requests, auth expiry/missing actor, no-auth, missing DB, disabled actor, same-origin cases, content type, oversize/malformed/unknown fields, wake boundaries, force type, all 409s, audit/capability failures, and exactly-one dispatch.

## Todo List

- [ ] Add strict request/response DTOs
- [ ] Add closed force-suspend error codes
- [ ] Reuse idle-suspend actor and origin guards
- [ ] Implement total coordinator-result mapping
- [ ] Register protected 16 KiB POST route
- [ ] Add auth/CSRF/validation/side-effect API tests
- [ ] Confirm no alternate unauthenticated transport exists

## Success Criteria

- A valid authenticated enabled actor receives `202` only after coordinator reports audited handoff acceptance.
- Missing/expired auth, no-auth mode, missing DB, disabled actor, or invalid cookie origin produces no coordinator command.
- Active/no-force returns `409` with exact authoritative count/breakdown and zero executor/RTC action.
- Invalid/oversized/unknown payloads fail before coordinator admission.
- Bearer and cookie auth follow their intended origin policies without weakening CORS or protected middleware.
- Every result is `no-store`, closed, bounded, and free of sensitive/helper/terminal detail.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| CSRF suspends host | Critical | HttpOnly cookie plus exact same-origin check and SameSite policy |
| Dev no-auth reaches privileged action | Critical | Explicit handler denial independent of middleware |
| Disabled/stale account acts | Critical | Database-backed enabled-subject check per request |
| UI lies about active sessions | Critical | Coordinator snapshot and force enforcement are authoritative |
| Client retries ambiguous POST | Critical | 202 request ID, no retry defaults, no Retry-After, status reconciliation |
| Error leaks host details | High | Closed codes and sanitized fixed messages |

## Security Considerations

- Authentication is necessary but not sufficient; origin, enabled actor, audit, capability, and confirmation gates all remain independent.
- Do not accept actor, request ID, host/device, path, command, mode, absolute wake time, or audit metadata from the body.
- Treat origin parsing ambiguity as rejection. Do not trust `Referer` as a substitute.
- Response fleet data contains counts/generation only; never expose session IDs or terminal content.
- Audit failure and unknown coordinator state map to unavailable, never to a best-effort action.

## Side-Effect Review Checklist

- [ ] Handler cannot invoke helper or fleet manager directly.
- [ ] Failed transport/auth/origin/validation requests produce zero audit/claim/executor effects.
- [ ] 409 confirmation and generation conflicts are never auto-retried.
- [ ] Accepted response does not claim suspend/resume success.
- [ ] Timing PATCH and status GET contracts remain backward compatible.
- [ ] Route is unreachable through public-health/auth exceptions.

## Next Steps

- Add the accessible popover action and confirmation flow in [Phase 04](./phase-04-host-popover-ui-and-confirmation-dialog.md).