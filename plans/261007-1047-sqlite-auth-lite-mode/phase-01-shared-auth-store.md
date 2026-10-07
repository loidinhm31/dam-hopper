# Phase 01 — Shared Authentication Store

## Context links
[Plan](./plan.md) · [Contracts](./contracts.md) · [Store research](./research/auth-storage-contracts.md) · [Auth architecture](../../docs/architecture/authentication-state-and-cryptography.md)
Dependency: none. All code paths below relative to worktree `/home/loidinh/WS/worktrees/dam-hopper-sqlite-auth`.

## Overview
Date: 2026-10-07. Priority: P2. Effort: 4h. Implementation: pending. Review: pending.
Extract a backend dispatch boundary without changing MongoDB authentication behavior.

## Key Insights
- `AuthStore` currently owns Mongo collections and is consumed by `AuthService`, MFA handlers, tests, and seeds.
- APIs separately define a reduced `User` and bypass store for registration/role/reauth.
- Shared BSON records can stay: same binary retains Mongo dependency; changing policy/date types is unnecessary.

## Requirements
- Single async shared `AuthStore`; Mongo adapter owns all collection/index details.
- Preserve existing method return values, mutation predicates, legacy absent authVersion behavior, and qualification hooks.
- Add shared user insertion and backend-independent duplicate username outcome for registration.
- No old constructor alias, facade Mongo accessor, trait-object framework, or model rewrite.

## Architecture
`AuthService -> AuthStore(enum dispatch) -> MongoAuthStore`; Phase 02 adds SQLite variant. Shared models and policy remain unchanged. Crypto/password verification stays outside storage adapter. Production API receives shared facade, never a raw database.

## Related code files
Modify:
- `server/src/auth/store.rs`: facade/error enum, `from_mongo`, `create_user`, existing methods.
- `server/src/auth/mod.rs`: module/export surface and store ownership; no wildcard legacy alias.
- `server/src/main.rs`, `server/src/state.rs`: constructor references until Phase 03 full integration.
- Constructor consumers in `server/examples/application_e2e_seed.rs`, `server/tests/common/auth_fixtures.rs`, `server/tests/auth_mfa_api.rs`, `auth_state_and_policy.rs`, `transport_enforcement_phase03.rs`, `server/src/api/resource_events.rs`.
Create:
- `server/src/auth/store/mongo.rs`: existing Mongo implementation relocated, no algorithm changes.
Delete: obsolete facade `database()` accessor; any reduced `api::auth::User` only after every actual caller migrates in Phase 03.

## Implementation Steps
1. Before exported symbol changes, query LSP references for `AuthStore`, `StoreError`, constructors/accessors and `AppState::new`; list all callers, including examples, cfg(test), and downstream server library consumers. If LSP unavailable, document bounded fallback search.
2. Move Mongo operations to `store/mongo.rs`; keep unique/TTL setup and legacy BSON semantics. Keep `get_user/get_session` qualification hooks once at facade entry, not duplicated across adapters.
3. Define facade enum/dispatch; explicit Mongo factory. Adapt every current constructor invocation in the same change. New SQLite variant joins only when implemented, not a no-op placeholder.
4. Introduce typed SQLite/join/invalid-record errors only when used in Phase 02. Duplicate registration usernames normalize to shared error; do not mask unrelated duplicate key or storage errors.
5. Add `create_user(UserRecord)` for Mongo with explicit ID generation and duplicate conflict mapping. Keep ordinary INSERT semantics; never upsert user authentication state.
6. Preserve current Mongo registration-independent store operations, `AuthService` policy and test clock behavior. Do not fix unrelated Mongo throttle race or index initialization policy here.

## Todo list
- [ ] Enumerate exported references and caller inventory.
- [ ] Extract Mongo adapter and implement facade.
- [ ] Add shared user insertion/error contract.
- [ ] Migrate every constructor/accessor caller without shims.

## Success Criteria
- Existing Mongo store/state-policy/HTTP suites continue to exercise real Mongo successfully when available.
- Shared API has no raw `Database` accessor used by production consumers; constructor migration complete.
- Live default Mongo login/MFA workflow remains unchanged at final Phase 04 smoke gate.
- No standalone test that merely checks forwarding, source text, or symbol names; use existing behavior tests.

## Risk Assessment
- Missing example or feature-gated caller: LSP inventory + `cargo check --all-targets` final gate.
- Mongo serialization/index drift: move implementation unchanged, compare contract predicates, keep real Mongo tests.
- Registration conflict mapping: test consumer-visible duplicate/error outcomes in Phase 04.

## Security Considerations
Preserve password hashing, enabled defaults, role defaults, challenge digest-only storage, encryption, replay/CAS and version semantics. Mongo implementation remains private to adapter, not a handler option.

## Next steps
Phase 02 implements full SQLite store before runtime selection. Build/lint/format/full tests run after coordinated edits, not mid-flight worker slices. Existing broken contracts updated alongside code; final runtime gate required.
