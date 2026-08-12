---
title: "Session-bound media stream authorization"
description: "Bind native video and image stream tickets to an authenticated, partitioned media session across trusted frontend/API origins."
status: in-progress
priority: P1
effort: 32h
branch: main
tags: [bugfix, backend, frontend, api, auth, security]
created: 2026-08-12
---

# Session-bound Media Stream Authorization

## Goal

Replace transferable media capability URLs with two-part authorization: opaque ticket + server-side media-session cookie. Preserve direct native image/video URLs, Range/HEAD, seeking, and browser-managed download.

## Fixed decisions

- Successful authenticated issuance creates/refreshes a random media session and sets `HttpOnly; Secure; SameSite=None; Partitioned; Path=/api/fs`; no insecure-cookie variant.
- Ticket stores actor subject + media-session binding. Every image/video `GET|HEAD` requires both. “Owning session” means the authenticated browser media session inside its top-level-site partition, not an individual tab or JWT/JTI login.
- Missing/foreign cookie → identical `404`; no ticket/session TTL touch. No Referer/Origin authorization and no bearer-only fallback.
- Credentialed CORS uses exact configured origins. Authenticated production rejects empty/`*`; remote media requires HTTPS.
- Unsupported cookie engines fail closed with actionable UI. Initial release claims require real Chromium + Edge evidence; Tauri qualification is separate follow-up.

## Phases

| # | Phase | Effort | Dependency | Status |
|---|---|---:|---|---|
| 1 | [Media session + strict CORS contract](./phase-01-server-media-session-and-strict-cors-contract.md) | 8h | None | DONE — 2026-08-12 20:05:25 +07:00 |
| 2 | [Ticket binding + stream/logout lifecycle](./phase-02-bind-media-tickets-and-stream-logout-lifecycle.md) | 8h | Phase 1 | DONE — 2026-08-13 00:20:59 +07:00 |
| 3 | [Frontend compatibility + deployment UX](./phase-03-frontend-native-media-compatibility-and-deployment.md) | 7h | Phase 2 contract | Pending |
| 4 | [Qualification, docs, rollout/rollback](./phase-04-qualification-documentation-and-rollout.md) | 9h | Phases 1–3 | Pending |

## End-to-end contract

1. Bearer/auth-cookie middleware establishes actor; no-auth establishes fixed `dev-user` only under guarded loopback policy.
2. Ticket issuance atomically creates/reuses bounded session, binds ticket, sets media cookie, returns `authorizationMode: session-cookie-v1`.
3. Client requires that version, probes ticket with credentialed `HEAD`, then assigns same opaque URL to native media or direct download.
4. Store authorizes without mutation; server revalidates file; store atomically rechecks lease/session/revocation then touches TTL immediately before response admission.
5. Logout/profile switch revokes current media session before auth/profile credential removal; workspace change retains global revocation.

## Dependencies

- Existing `MediaTicketStore`, video/image adapters, auth actor extension, sandbox revalidation, native Range response path.
- Exact deployment origin list, production HTTPS certificate/proxy, and supported Chromium/Edge versions.
- Single server process or sticky routing; shared session store deferred until multi-instance deployment exists.

## Scope guard

No JWT redesign, database persistence, service worker, Blob buffering, MSE, signed URL, Referer auth, tab/per-login binding, or capability fallback. Existing semantic-navigation uncommitted work untouched.

## Validation Summary

**Validated:** 2026-08-12
**Questions asked:** 4

### Confirmed Decisions

- Initial release gate: real Chromium + Edge; Tauri qualification later.
- HTTPS/local HTTP development setup: out of scope; production remote HTTPS invariant stays.
- Limits accepted: 30m idle, 8h absolute, and proposed global/per-actor/per-session bounds.
- Deployment rollout procedure: out of scope; version skew must still fail closed with no bearer fallback.

### Action Items

- [ ] Revise Phase 4 before implementation: move Tauri from release blocker to follow-up.
- [ ] Remove local HTTPS/loopback and rollout-rehearsal tasks; preserve Secure cookie and fail-closed contracts.
- [ ] Release owner sets minimum Chromium and Edge versions.

## Unresolved questions

- Exact minimum Chromium and Edge versions.
