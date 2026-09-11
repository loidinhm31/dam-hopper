---
title: "Cross-Origin Port Transport Guard Fix"
description: "Align privileged mutation CSRF guards with validated Bearer authentication and the server's exact CORS origin allowlist."
status: complete
priority: P1
effort: 5h
branch: feat/terminal-idle-suspend
tags: [bugfix, backend, api, auth, security]
created: 2026-09-07
---

# Cross-Origin Port Transport Guard Fix

## Overview & Problem Statement

UAT serves web/API on `:4804`/`:4803`; production on `:4802`/`:4801`. Current idle-suspend and host-action mutation guards treat any `Cookie` header as cookie authentication, then require `Origin` authority to equal `Host`. The browser sends both `Authorization: Bearer <jwt>` and ambient cookies because REST fetches use `credentials: "include"`; valid split-port requests therefore fail `403 invalidOrigin` even when `DAM_HOPPER_CORS_ORIGINS` explicitly trusts the web origin.

Affected paths:

- `PATCH /api/system/idle-suspend/v1/timing`
- `POST /api/system/idle-suspend/v1/force-suspend`
- Host-action mutations guarded by `require_action_request`: intent creation, approval, execution creation

Root cause and request trace: [`../reports/debugger-260907-0151-force-suspend-invalid-origin.md`](../reports/debugger-260907-0151-force-suspend-invalid-origin.md).

Desired transport policy, after protected auth middleware:

1. Require JSON as today.
2. Valid Bearer-authenticated request: no cookie CSRF-origin constraint, whether an ambient cookie is absent or present (Phase 03 REQ-15).
3. Cookie-only request: require exactly one valid `Origin`; accept exact configured `cors_origins` or strict same-origin through `AppState::origin_is_allowed`.
4. Cookie-only foreign, missing, malformed, or ambiguous origin: retain `403 invalidOrigin`.
5. Preserve all actor, database, no-auth, body-limit, coordinator, audit, and side-effect gates.

No frontend change, new configuration, wildcard CORS, dependency, schema, or compatibility shim.

## Proposed Changes

### Decision: one origin authority, Bearer-aware guards

Use `AppState::origin_is_allowed` as the only server origin policy instead of two endpoint-local `same_origin` implementations. Share the same exact Bearer header parser used by authentication, avoiding guard/auth syntax drift. Protected authentication remains authoritative: an invalid Bearer value is rejected before any Bearer exemption can reach a privileged handler.

Preserve strict ambiguity rejection while centralizing policy:

- Require exactly one `Origin` in `origin_is_allowed`.
- Exact configured origin may differ from API `Host`/port.
- Same-origin fallback still requires exactly one `Host`, HTTP(S), no userinfo, and no path/query.
- Keep the existing duplicate-Origin regression green; strengthen all consumers of the shared helper (REST, WebSocket, media-origin marker).

Guard predicate:

```text
uses_cookie_only = Cookie present AND no syntactically valid Bearer header
reject invalidOrigin when uses_cookie_only AND NOT state.origin_is_allowed(headers)
```

### Files

| Path | Action | Change |
|---|---|---|
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/auth.rs` | Modify | Expose a crate-local, allocation-free Bearer header parser; reuse it in `extract_token` and both transport guards. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/state.rs` | Modify | Keep `origin_is_allowed` as shared authority; reject duplicate `Origin` and duplicate `Host` before exact allowlist/same-origin decisions. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/idle_suspend.rs` | Modify | Pass `&AppState` into `verify_transport_guards`; apply Bearer exemption; use `state.origin_is_allowed`; remove obsolete local `same_origin`; update timing and force-suspend callsites/comments. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/host_actions.rs` | Modify | Add `State<AppState>` extractor to `require_action_request`; use identical Bearer/cookie/origin decision; remove obsolete local `same_origin`. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/router.rs` | Modify | Replace all three host-action `from_fn` route layers with `from_fn_with_state(state.clone(), ...)`; preserve outer protected auth middleware ordering. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/tests.rs` | Modify | Add route-level split-port/CORS, Bearer-with-cookie, Bearer-without-cookie, invalid-Bearer, and foreign cookie-only regressions across affected guards. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/api-reference.md` | Modify | Document exact allowlisted cross-port cookie origins and Bearer exemption despite ambient cookies. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/terminal-idle-suspend-security.md` | Modify | Update CSRF invariant/mitigation without weakening actor or fail-closed requirements. |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/CHANGELOG.md` | Modify | Record split-port/CORS guard fix and retained foreign-origin denial. |

## Phases & Step-by-Step Tasks

### Phase 1 — Centralize credential/origin classification (1.5h)

1. In `api/auth.rs`, extract the existing case-sensitive `Bearer ` parsing into a crate-local helper returning the borrowed token slice. Keep Authorization precedence over cookie fallback and existing JWT validation unchanged.
2. In `state.rs`, read `Origin` via `get_all`; fail unless exactly one value is present and valid UTF-8. Match exact canonical `cors_origins` first.
3. For same-origin fallback, parse the URI as today and require exactly one valid `Host`. Preserve HTTP(S), path/query, userinfo, and case-insensitive authority checks.
4. Do not normalize request origins at runtime, compare hostname-only, ignore ports, accept wildcards, or use `Referer`/`Sec-Fetch-Site` as substitutes.

Acceptance:

- Configured `http://100.91.26.60:4804` accepted for API host `100.91.26.60:4803`.
- Unconfigured `https://evil.attacker.com` rejected.
- Duplicate/malformed origin remains rejected.
- Authentication behavior and token precedence unchanged.

### Phase 2 — Apply policy to every sister endpoint (1.5h)

1. Change `verify_transport_guards` to accept `&AppState` before headers.
2. After content-type validation, classify Bearer before cookie presence. Only cookie-only requests call `state.origin_is_allowed`.
3. Update `update_timing` and `force_suspend` to pass `&state`; retain current guard order and closed error bodies/statuses.
4. Delete idle-suspend local `same_origin` and its now-unused `Uri` import.
5. Change `require_action_request` to extract `State<AppState>` and apply the same classification. Delete host-actions local `same_origin`.
6. In `router.rs`, provide cloned state to all three host-action mutation route layers. Keep protected `require_auth` outermost so only authenticated Bearer requests reach the exemption.
7. Do not change GET routes, auth requirements, body limits, DTOs, CORS configuration parsing, coordinator logic, or host-action execution semantics.

Acceptance:

- Timing, force-suspend, and all host-action mutation routes share one origin authority.
- Bearer plus ambient cookie no longer becomes cookie-only.
- Cookie-only trusted split-port requests pass transport admission.
- Cookie-only foreign requests still fail before handler side effects.

### Phase 3 — Regression coverage and contract synchronization (2h)

1. Expand `idle_suspend_timing_patch_guards`:
   - Configure `http://127.0.0.1:4804` with `build_router_with_origins`; send cookie-only request to Host `127.0.0.1:4803`; assert transport admission reaches the existing safe downstream `503 authenticationUnavailable` result, not `invalidOrigin`.
   - Keep foreign cookie-only request at exact `403 invalidOrigin`.
2. Expand `idle_suspend_force_suspend_transport_and_auth_guards`:
   - Add configured split-port cookie-only admission.
   - Keep Bearer-without-cookie coverage.
   - Add valid Bearer plus ambient cookie and foreign/mismatched Origin; assert the precise downstream `503 authenticationUnavailable` result.
   - Keep duplicate, malformed/userinfo/path, and foreign cookie-only `invalidOrigin` coverage.
3. Replace/expand the host-action cookie test into a transport-policy regression:
   - Configured split-port cookie-only request reaches exact downstream `503 reauthUnavailable`.
   - Valid Bearer without cookie reaches `503 reauthUnavailable`.
   - Valid Bearer plus ambient cookie reaches `503 reauthUnavailable` even when Origin is not same-origin.
   - Foreign cookie-only request returns exact `403 invalidOrigin`.
   - Invalid Bearer cannot use a valid ambient cookie to bypass auth; assert `401 Unauthorized`, preserving Authorization precedence.
4. For admission cases, assert exact downstream status/error code instead of weak “not 403” checks. Test fixtures remain database/helper/coordinator-safe; no real suspend or host action.
5. Update API/security docs and changelog. Clarify configured CORS origins are trusted mutation origins; wildcard remains forbidden.

Acceptance:

- Tests fail on either original defect: strict port equality or cookie-presence misclassification.
- Tests cover both idle-suspend mutations and host-action middleware state wiring.
- No test invokes system suspend, helper IPC, RTC, or production MongoDB.

## Testing & Verification Plan

Run focused tests first:

```bash
cd server
cargo test idle_suspend_timing_patch_guards -- --nocapture
cargo test idle_suspend_force_suspend_transport_and_auth_guards -- --nocapture
cargo test host_action_transport_guards -- --nocapture
```

Then server regression checks:

```bash
cd server
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Behavior matrix:

| Credential/header shape | Origin | Expected transport result |
|---|---|---|
| Cookie only | Exact same-origin | Admit |
| Cookie only | Exact configured CORS origin on different port | Admit |
| Cookie only | Foreign/unconfigured | `403 invalidOrigin` |
| Cookie only | Missing/malformed/duplicate | `403 invalidOrigin` |
| Valid Bearer, no cookie | Missing or foreign | Admit; protected actor checks remain |
| Valid Bearer + ambient cookie | Missing or foreign | Admit; protected actor checks remain |
| Invalid Bearer + valid cookie | Any | `401`; no cookie fallback |
| Any accepted transport, missing DB in test fixture | N/A | Exact safe downstream `503` code; proves admission without side effects |

Do not smoke-test force suspend against an enrolled real host. Route tests with unavailable DB/helper/coordinator are the safe behavioral proof. Optional deployment check only on an explicitly non-enrolled test server: inspect browser request headers and confirm the configured `:4804 -> :4803` request no longer returns `invalidOrigin`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Misconfigured CORS origin gains cookie mutation access | Exact canonical startup allowlist only; no wildcard/runtime hostname relaxation; document trusted-origin responsibility. |
| Forged/invalid Bearer header skips CSRF guard | Protected auth middleware executes first and prefers Authorization; invalid Bearer regression must return `401`. |
| Shared helper weakens duplicate-header rejection | Harden `origin_is_allowed` to require exactly one Origin/Host where applicable; retain existing ambiguity tests. |
| One host-action route misses stateful middleware | Update all three mutation route layers together; route-level tests exercise middleware. |
| Fix accidentally reaches privileged side effects during testing | Use current no-DB/inert fixtures and assert safe downstream failures; never run real suspend. |

## Rollback Strategy

- Revert the server guard, state-helper hardening, router middleware wiring, tests, and documentation as one change.
- Redeploy the prior server binary; no database/schema/config rollback needed and frontend artifacts remain unchanged.
- Keep `DAM_HOPPER_CORS_ORIGINS` configuration intact. Rollback restores the known split-port `403 invalidOrigin` behavior but does not alter CORS preflight policy.
- Before rollback release, rerun the retained foreign-origin tests to confirm the prior fail-closed behavior remains intact.

## Unresolved Questions

None. The existing exact `DAM_HOPPER_CORS_ORIGINS` allowlist is the approved trust source, and Phase 03 REQ-15 already defines Bearer callers as exempt from cookie CSRF origin checks.
