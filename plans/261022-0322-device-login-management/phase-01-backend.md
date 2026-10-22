# Phase 01 — Backend session inventory and revocation

## Overview
- Status: complete. Priority: P2. Owner: backend agent, exclusively `server/**`.
- Dependency: frozen [contract](./contracts.md) and [overview](./plan.md); concurrent with 02, no frontend dependency.
- Context: `agent://ScoutAuthDevices`; [auth architecture](../../docs/architecture/authentication-state-and-cryptography.md), [API](../../docs/api/authentication.md).
- Reuse `AuthSession`, `AuthenticatedActor`, `AuthStore` facade, clock, auth errors, cookie/no-store helpers and existing live authorization; no second session registry.

## Files and actions
| Action | Existing file / new path | Work |
| --- | --- | --- |
| Modify | `server/src/auth/model.rs` | Nullable legacy-compatible `user_agent`; narrow list/cursor/store result types where appropriate |
| Modify | `server/src/auth/store.rs` | Dispatch bounded list and owner-constrained idempotent revoke to both stores |
| Modify | `server/src/auth/store/mongo.rs` | Filtered keyset query, deterministic order/index, atomic owner predicate |
| Modify | `server/src/auth/store/sqlite.rs` | Equivalent query/revoke and insert binding |
| Modify | `server/src/auth/store/sqlite/records.rs` | Explicit column list and checked optional metadata mapping |
| Modify | `server/src/auth/store/sqlite/open.rs` | Append migration to ordered `MIGRATIONS` |
| Create | `server/src/auth/store/migrations/002-session-user-agent.sql` | Add nullable column and useful session-list index; preserve 001 verbatim |
| Modify | `server/src/api/auth_mfa.rs` | HeaderMap on full MFA enrollment/login completion; capture metadata only on new session |
| Modify | `server/src/api/auth.rs`, `server/src/api/router.rs` | Session endpoints, protected registration, shared cookie/error/no-store handling |
| Modify as needed | `server/src/fs/media_ticket.rs` | Reuse exact-session invalidation; no actor-wide sibling revocation |
| Modify tests | `server/tests/auth_sqlite_store.rs`, `server/tests/auth_state_and_policy.rs`, `server/tests/auth_mfa_api.rs`, `server/tests/auth_no_auth.rs` | Store parity, metadata and unavailable-mode regressions |
| Create | `server/tests/auth_device_sessions.rs` | Real SQLite route acceptance using `server/tests/common/auth_fixtures.rs` |
| Modify all constructors | `server/src/auth/mod.rs`, `server/src/api/{resource_events,tests}.rs`, `server/tests/{auth_lite_mode,auth_sqlite_store,auth_state_and_policy}.rs`, `server/tests/common/auth_fixtures.rs`, `server/examples/{application_e2e_seed,agent_free_consent_fixture}.rs` | Explicit metadata default; search all `AuthSession` literals, including production constructors above |

No obsolete API is removed: existing logout and auth-wide invalidation still have independent callers. No new dependency unless existing facilities demonstrably cannot express the frozen contract.

## Implementation steps
1. Add `#[serde(default)]` optional user-agent storage. Normalize absent/empty to null; accept only valid text; truncate at a UTF-8 character boundary to at most 512 bytes. Extract HeaderMap before Json in both full-session handlers. Preserve original value on MFA step-up and leave lifetime/version policy unchanged.
2. Extend SQLite with additive version 2 migration using current transactional migration runner; update SESSION_COLUMNS, inserts and decode together. Existing v1 rows become null; no recreation/data reset. Add equivalent Mongo ordered query index without changing TTL behavior.
3. Define typed facade operations receiving authenticated username/current authVersion, current time and decoded cursor. Query only unrevoked, unexpired matching-version sessions, including MFA-due rows. Sort `(issuedAt DESC, id DESC)`; fetch 51, emit at most 50. Keep timestamp precision consistent with BSON/SQLite milliseconds. Cursor encodes last returned timestamp+ID, is bounded/validated, and applies strict lexicographic continuation; reject malformed cursor with 400.
4. Implement owner-scoped revocation with username and session ID in the storage mutation predicate. Preserve first revokedAt; distinguish owned existing record (including previously revoked) from foreign/missing without relying on changed-row count alone. Use atomic conditional update/transaction semantics, including concurrent repeats. Keep foreign and missing indistinguishable at API boundary.
5. Add `GET /api/auth/sessions` and `DELETE /api/auth/sessions/{id}` to protected routes. Derive username/authVersion/current ID from validated actor, never request body. Serialize only `id,userAgent,issuedAt,expiresAt,mfaVerifiedAt,current`; dates UTC RFC3339. Never serialize stored auth documents wholesale.
6. Return 204 after acknowledged owned revoke. Enforce Bearer-only mutation: if authenticated via cookie or malformed headers falling back to cookie, return 403 `BearerRequired` before storage mutation. Emit zero `Set-Cookie` headers on DELETE responses, ensuring unrelated or replacement browser cookies are never cleared. Invalidate target media capabilities only, using `revoke_by_actor_or_session(subject, Some(target_id))` after owned-record success. Do not revoke every session of the account. Development bypass returns 409 `DEVICE_SESSIONS_UNAVAILABLE` for both endpoints.
7. Apply `Cache-Control: no-store` around the endpoint-specific middleware boundary so success, 400/401/403/404/409 and storage/auth failures carry it. Reuse existing auth error body conventions. DELETE strictly rejects cookie credentials without storage mutations and emits no Set-Cookie.
8. Author regressions now; execute none mid-flight. Hand off changed files, API/cursor notes, migration effects and exact suggested checks to parent. Do not edit shared plan/docs.

## Regression source requirements
- Real v1 database created from original 001 schema with existing user/session; reopen through AuthStore and verify version upgrade, preserved rows, nullable metadata and idempotent reopen. Fresh version-2 database also works.
- Metadata absent, empty, multibyte and >512 bytes; capture on enrollment and ordinary MFA login; preservation through step-up; legacy Mongo deserialization. Invalid header text cannot panic or bypass bounds.
- Static dataset: more than 50 rows, equal timestamps across page boundary, no duplicates/skips, correct nextCursor/termination and malformed/oversized cursor. Current marker may occur after page one.
- Own/foreign/revoked/expired/authVersion-mismatched rows; MFA-due row remains visible. Equivalent SQLite/Mongo behavior and concurrent list/revoke. Concurrent keyset pagination is not a snapshot: require deterministic continuation, ownership filters, and exclusion of rows revoked before each relevant query; newly inserted rows may require refresh.
- Foreign/missing 404 equivalence; owned repeated DELETE 204 under a surviving caller; first revokedAt unchanged. Retrying with the revoked caller itself is unauthorized, not a promise of 204.
- Self revoke returns 204 with zero Set-Cookie; revoked bearer denied, foreign/replacement cookies preserved, sibling session still valid; cookie-only and malformed DELETE rejected with 403 BearerRequired (or 401 on invalid bearer); no-auth 409; no-store on rejected requests; no secret fields.

## Risks and side effects
- Schema mapping/literal omissions affect auth fixtures and seed executable: migrate every constructor, not just API happy paths.
- Generic auth middleware may reject before handler: no-store must wrap it rather than be handler-only.
- Existing HTTP/new-WS checks already consult persistence. WS auth watcher polls every 5 seconds with 2-second store timeout; resource SSE does likewise. Media admission and read-driven revalidation are separate. Do not invent instantaneous cutoff or rewrite transport architecture.
- Mongo fixture skips are not proof; parent/tester must record and resolve reachable missing-Mongo qualification.

## Success criteria / handoff
- All frozen backend semantics implemented across both stores; regression sources cover migration, metadata, ownership, pagination, Bearer-only revocation, and bypass behavior.
- Code reviewed and APPROVED with zero blockers in [reports/review-backend-final.md](./reports/review-backend-final.md).
- Backend regression suites verified passing in [reports/review-fixes-validation.md](./reports/review-fixes-validation.md).

## Unresolved questions
None requiring user input. Cookie authority and live-cutoff observations remain explicit security/qualification obligations, not undocumented guarantees.
