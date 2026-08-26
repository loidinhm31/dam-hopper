---
title: "Authenticated HTTP media deployments"
description: "Allow session-bound image/video media over HTTP without weakening Bearer-protected APIs or ticket lifecycle controls."
status: pending
priority: P1
effort: 22h
branch: main
tags: [bugfix, backend, frontend, api, auth, security, docs]
created: 2026-08-13
---

# Authenticated HTTP Media Deployments

## Goal

Support authenticated HTTP deployments globally. Keep Bearer auth primary for protected APIs and media issue/revoke; keep stream authorization cookie-only with opaque session-bound tickets, TTL/capacity, file revalidation, and revocation.

## Fixed contract

- Remove authenticated non-loopback HTTPS/TLS-proxy startup refusal, `--trusted-tls-proxy`, mandatory CORS configuration, HTTP-origin rejection, and frontend HTTPS refusal.
- Media cookie becomes host-only `HttpOnly; SameSite=Lax; Path=/api/fs; Max-Age=28800`; omit `Secure`, `Partitioned`, and `Domain` on set/clear. Keep `session-cookie-v1` because authorization semantics stay unchanged.
- Auth fallback cookie becomes host-only `HttpOnly; SameSite=Strict; Path=/`; omit `Secure` on set/clear. Bearer remains preferred and required by the UI for protected issue/revoke/session-revoke calls.
- Unset CORS means no cross-origin authorization; configured exact HTTP/HTTPS origins remain credentialed. Never restore wildcard/reflection.
- Supported HTTP browser topology is same-origin or schemefully same-site frontend/API. Cross-site HTTP media is unsupported: `SameSite=None` requires `Secure`, so no technically valid cookie can provide that combination.
- Cleartext cookies, Bearer tokens, ticket paths, and media bytes are interceptable/modifiable. Product accepts this transport risk; docs must recommend HTTPS on untrusted networks without blocking HTTP.

## Phases

| # | Phase | Effort | Dependency | Status | Progress |
|---|---|---:|---|---|---:|
| 1 | [Preflight and backend HTTP contract](./phase-01-preflight-and-backend-http-contract.md) | 6h | None | Pending | 0% |
| 2 | [Frontend HTTP media lifecycle](./phase-02-frontend-http-media-lifecycle.md) | 5h | Phase 1 wire contract | Pending | 0% |
| 3 | [Security and browser regression matrix](./phase-03-security-and-browser-regression-matrix.md) | 6h | Phases 1–2 | Pending | 0% |
| 4 | [Documentation and release gate](./phase-04-documentation-and-release-gate.md) | 5h | Phases 1–3 | Pending | 0% |

## Dependencies

- Existing shared `MediaTicketStore`, actor/session binding, native Range/HEAD responder, profile revoke sequence, and exact CORS builder.
- Real installed Chromium for HTTP cookie/native-media qualification.
- Same server process or sticky routing; shared session persistence remains out of scope.

## Scope guard

No TLS implementation, proxy detection, per-request cookie-mode negotiation, JWT redesign, database/shared ticket store, service worker, Blob/MSE fallback, bearer stream fallback, wildcard CORS, or cross-site HTTP support claim. Preserve unrelated worktree changes and historical completed plans.

## Preflight release invariant

Before edits, capture baseline focused tests and a clean target-file diff. After each phase, verify no URL/query/log contains Bearer, media cookie, or new ticket material; no stream route enters Bearer middleware; no issue/revoke route leaves it.

## Unresolved questions

- None. HTTP interception risk and cross-site HTTP limitation accepted.
