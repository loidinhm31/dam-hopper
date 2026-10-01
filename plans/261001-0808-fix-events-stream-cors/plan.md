---
title: "Fix events stream CORS preflight"
description: "Allow Cache-Control and Pragma request headers so allowed-origin host-resource SSE fetches pass preflight."
status: done
priority: P1
effort: 1h
branch: main
tags: [bugfix, backend, api, cors, sse]
created: 2026-10-01
---

# Fix events stream CORS preflight

## Goal

Restore cross-origin `GET /api/system/resources/v1/events` from `http://100.91.26.60:4802`; support normal SSE requests and DevTools cache-disabled requests. Planning only; no implementation or validation results claimed.

## Evidence

- [Diagnostic report](../reports/debugger-261001-0808-cors-preflight-and-agent-status.md), §§3–4: OPTIONS already returns 200, but omits requested cache headers. Browser blocks the subsequent GET.
- `packages/ui/src/api/ws-transport.ts:1949–1964`: bearer-authenticated fetch sends `Cache-Control: no-store`; DevTools may also request `Pragma`.
- `server/src/api/router.rs:774–803`: explicit request allowlist lacks both headers. `CACHE_CONTROL` already imported and response-exposed; `PRAGMA` not imported.
- `server/tests/host_resource_events.rs:200–246`: real-route preflight coverage exists, but requests no non-safelisted headers.

## Decision and scope

- Keep one shared `build_cors` policy. Add `CACHE_CONTROL` and `PRAGMA` to allowed request headers; add only the missing import. Keep `CACHE_CONTROL` response exposure.
- Strengthen existing events integration preflight test; no duplicate fixture or new module.
- Preserve exact-origin allowlist, credentials policy, methods, SSE admission/auth, cache semantics, and frontend transport.
- No wildcard/reflected headers, frontend workaround, agent-status polling changes, retries, or SSE redesign.
- Follow `AGENTS.md` and `docs/code-standards.md`; `docs/development-rules.md` absent in current checkout. [Architecture invariants](../../docs/system-architecture.md#authentication--security) remain unchanged; implementation restores intended preflight contract.

## Phase

| # | Phase | Status | Effort |
|---|---|---|---|
| 1 | [Fix CORS headers and regression proof](./phase-01-fix-cors-headers.md) | Done (2026-10-01 09:02 Asia/Saigon; 13/13 tests passed) | 1h |

## Acceptance

- Allowed-origin OPTIONS on events route, requesting GET and `authorization, cache-control, pragma`, returns 200, exact allowed origin, GET permission, and all three requested header tokens.
- Regression fails before fix on missing cache header permission, passes after; HTTP 200 alone is not sufficient proof.
- Unconfigured/disallowed origins remain unpermitted; OPTIONS still consumes zero stream permits. Existing SSE/auth tests remain valid.
- Rebuilt runtime preflight and browser SSE smoke pass, including cache-disabled case; stream emits status/data, not just successful headers.
- Required Rust commands pass; API docs and changelog describe fix after verification.

## Verification handoff

Run once after implementation lands; working directory `server/`:

```bash
cargo test -p dam-hopper-server --lib api::router::tests
cargo test --test host_resource_events
cargo check --tests
```

Live preflight and browser steps: [phase verification](./phase-01-fix-cors-headers.md#verification). Main agent owns consolidated validation. No Rust commands run during this planning assignment.

## Dependencies and risks

- Existing Axum/tower-http types and test fixtures; no dependency/schema/config migration.
- Runtime must use rebuilt backend and exact configured frontend origin. Old binaries/proxy responses can mask fix.
- Shared policy permits two additional request headers for every configured origin; it grants neither new origins nor authentication bypass.
- CORS smoke is scoped proof, not completion of separate host-resource SSE release qualification.

## Unresolved questions

None. Implementation scope and regression location resolved from current code.

## Next steps

1. Run live runtime preflight smoke and browser SSE stream smoke (with cache enabled and DevTools cache disabled).
2. Update `docs/api-reference.md` (events origin/header paragraph) and `docs/CHANGELOG.md` (concise preflight bugfix entry).
