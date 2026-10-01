# Phase 01 — Fix CORS request headers

## Overview

- Priority: P1. Status: Done 2026-10-01 09:02 Asia/Saigon. Effort: 1h.
- Restore intended events-stream preflight by adding two explicit request header permissions. No frontend change.

## Context links

- [Main plan](./plan.md)
- [Diagnostic report, §§3–4](../reports/debugger-261001-0808-cors-preflight-and-agent-status.md)
- [Router and shared CORS](../../server/src/api/router.rs)
- [Real-route SSE tests](../../server/tests/host_resource_events.rs)
- [Frontend SSE fetch](../../packages/ui/src/api/ws-transport.ts)
- [Repository guidelines](../../AGENTS.md), [code standards](../../docs/code-standards.md)
- [Normative SSE architecture](../../docs/architecture/host-resource-sse.md), [API contract](../../docs/api-reference.md#get-apisystemresourcesv1events)

## Key insights

- Port 4802 frontend and port 4801 API are different origins. Authorization already requires preflight; removing manual cache header would not fully solve DevTools requests.
- `allow_headers` authorizes request headers; `expose_headers` makes response headers readable. `CACHE_CONTROL` belongs in both lists; do not move/remove its exposure.
- Current tower-http response can be HTTP 200 even when missing requested header permissions. Assert browser-relevant header membership.
- OPTIONS is handled by outer CORS before SSE auth/admission. Existing test also checks zero active global permits and 405 when CORS is unconfigured.

## Requirements and architecture

1. Explicit `CACHE_CONTROL` and `PRAGMA` request permissions for configured origins.
2. Existing methods, response exposure, `.allow_credentials(true)`, and exact-origin policy unchanged.
3. Regression exercises real events route with `Origin`, requested GET, and all three non-safelisted request headers.
4. Authenticated GET remains bearer-only; no cookies/query tokens, profile IDs, or new wire contract.
5. No additional services, allocations on the stream path, dependencies, configuration, or monitoring. Two static allowlist entries only.

Flow: browser OPTIONS → shared CORS checks configured origin and emits request permissions → browser permits GET → existing origin/auth/admission middleware → existing SSE status/data frames. Existing architecture unchanged beyond correcting incomplete request-header policy.

## Related files

| Action | Repository path | Change |
|---|---|---|
| Modify | `server/src/api/router.rs` | Import `PRAGMA`; reuse imported `CACHE_CONTROL`; extend `build_cors` request header array |
| Modify | `server/tests/host_resource_events.rs` | Extend `test_cors_preflight_configured_vs_empty` with cache-header regression assertions |
| Modify after proof | `docs/api-reference.md` | Events origin/header paragraph: allowed request cache headers vs response cache control |
| Modify after proof | `docs/CHANGELOG.md` | Concise events preflight bugfix entry; report only exercised evidence |
| Intentionally unchanged | `packages/ui/src/api/ws-transport.ts` | Keep `Cache-Control: no-store`, `cache: "no-store"`, bearer headers and fetch options |
| Intentionally unchanged | Router unit tests and SSE architecture | Existing origin, custom-header, admission and auth contracts still apply; no redesign |

No production/test files created or deleted. This assignment creates only the two requested plan files.

## Implementation steps

1. Reuse existing `header` imports, `build_cors`, and integration fixture. Recheck only target sections if code changed since planning.
2. Add regression coverage to existing `test_cors_preflight_configured_vs_empty` before modifying CORS:
   - Use explicit allowed origin `http://100.91.26.60:4802`; pass it to existing state and router constructors. Never hardcode production origin into server policy.
   - In allowed-origin branch, send OPTIONS to `/api/system/resources/v1/events`, `Access-Control-Request-Method: GET`, and `Access-Control-Request-Headers: authorization, cache-control, pragma`.
   - Preserve empty body, HTTP 200, exact `Access-Control-Allow-Origin`, and zero global permits assertions.
   - Read `Access-Control-Allow-Headers`, split on commas, trim whitespace, compare tokens case-insensitively. Require `authorization`, `cache-control`, `pragma`; do not assert entire serialized header string/order or use substring matching.
   - Check GET token in `Access-Control-Allow-Methods` using same token semantics. Preserve existing empty-origin branch's 405/no-permit behavior; use same requested headers there.
   - Keep shared origin-denial router test and SSE GET admission tests; no duplicate new fixtures/tests.
3. Record failing-before evidence with scoped command from `server/`:

   ```bash
   cargo test --test host_resource_events test_cors_preflight_configured_vs_empty
   ```

   Expected failure: missing `cache-control` or `pragma` token. If target already fixed concurrently, do not revert it to manufacture failure; use report's recorded before evidence and document boundary.
4. In `server/src/api/router.rs`:
   - `CACHE_CONTROL` already imported from `axum::http::header`; add `PRAGMA` to same import group.
   - Add both constants to `let headers = [...]`, near `IF_MODIFIED_SINCE`, before custom plugin headers:

   ```rust
   IF_MODIFIED_SINCE,
   CACHE_CONTROL,
   PRAGMA,
   X_EXPECTED_SHA256,
   ```

   - Keep `CACHE_CONTROL` in `exposed_headers`; no reason to response-expose `PRAGMA`.
   - Leave origin handling, methods and credentials policy untouched. No `Any`, mirrored request headers, endpoint-specific CORS, or client suppression.
5. Run focused regression after change; main agent runs required consolidated commands once all changes land. Perform live runtime/browser verification below.
6. After successful smoke, update existing API paragraph and changelog; clearly distinguish request-header permissions from SSE response `Cache-Control: private, no-store, no-transform`. Do not claim full SSE rollout qualification or change agent-status behavior.

## Verification

### Required commands

Working directory: `server/`. Main agent owns consolidated validation; record exit/result per command:

```bash
cargo test -p dam-hopper-server --lib api::router::tests
cargo test --test host_resource_events
cargo check --tests
```

Router tests cover origin denial, credentialed policy and existing custom headers. Events tests cover real-route preflight, empty policy, auth, origin admission and stream lifecycle. Do not use project-root Cargo commands without manifest selection; Cargo manifest is in `server/`.

### Live preflight smoke

Use rebuilt running backend with exact `DAM_HOPPER_CORS_ORIGINS=http://100.91.26.60:4802` or equivalent existing configuration. Do not change deployed allowlist or production auth merely to test.

```bash
curl -i -X OPTIONS http://127.0.0.1:4801/api/system/resources/v1/events \
  -H 'Origin: http://100.91.26.60:4802' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization, cache-control, pragma'
```

Expected: HTTP 200; `Access-Control-Allow-Origin` equals requested allowed origin; allow-methods includes GET; allow-headers includes all three exact tokens. Repeat with unconfigured origin such as `http://attacker.invalid`; expected no matching allow-origin, not necessarily non-200. Curl does not enforce CORS and is insufficient alone.

### Browser stream smoke

- Open actual frontend at configured cross-origin origin, using an authenticated connected profile and visible host-resource interest. Prefer existing local smoke environment if production access unavailable; document actual origins.
- Verify first with cache enabled, then DevTools Disable cache enabled. Cancel/reopen stream to produce a fresh request; disable-cache run exercises explicit requested cache headers where browser emits them.
- Network: requested OPTIONS cache-header permissions present; subsequent GET reaches HTTP 200 with `text/event-stream; charset=utf-8`; initial `host-resources-status` and `host-resources` frames arrive. No cache-control/pragma CORS error.
- Actual surface: host resource view receives live paired values. No fallback-only claim based on changing numbers; verify stream delivery, not merely REST success or HTTP 200.
- Preserve bearer authentication; do not log/copy token into plan/report. Close browser stream after smoke. If required authenticated/browser runtime unavailable, state exact missing prerequisite; no fabricated proof.

## Success criteria

- Requested three-header preflight succeeds for exact allowed origin; regression catches omitted cache permission.
- `CACHE_CONTROL` remains response-exposed; frontend cache/auth options unchanged.
- Empty CORS still returns 405 in existing fixture; unconfigured origins receive no matching allow-origin; preflight consumes no SSE permits.
- Required Rust checks and real preflight/browser path verified; docs accurately updated.

## Risks and security

- Shared policy change applies to all configured origins/endpoints. Only two cache-control request headers added; no new origin, method, credential mechanism or authorization bypass.
- Old server binary, stale preflight cache, or proxy header rewriting can mask result. Verify rebuilt runtime; inspect browser network/preflight rather than rerunning unrelated suites.
- Tests must remain deterministic and order-independent; reuse current fixture/environment lock and existing temporary state.
- No caching changes: allow request controls without weakening private no-store/no-transform SSE response.
- Rollout: backend rebuild/restart through existing release process; frontend deployment not required. Rollback through existing release process restores prior policy and known failure; do not introduce compatibility shims.

## Unresolved questions

None. Live authenticated/browser availability is a verification prerequisite, not an open design decision.

## Next steps

1. Execute live runtime preflight smoke and browser SSE stream smoke (DevTools cache disabled).
2. Update `docs/api-reference.md` and `docs/CHANGELOG.md` with exercised results.
