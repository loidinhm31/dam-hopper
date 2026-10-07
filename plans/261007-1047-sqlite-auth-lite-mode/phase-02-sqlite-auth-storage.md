# Phase 02 — SQLite Authentication Storage

## Context links
[Plan](./plan.md) · [Contracts/schema/mutations](./contracts.md) · [Storage research](./research/auth-storage-contracts.md)
Dependency: [Phase 01](./phase-01-shared-auth-store.md). Worktree paths as Phase 01.

## Overview
Date: 2026-10-07. Priority: P2. Effort: 7h. Implementation: pending. Review: pending.
Implement file-backed SQLite for every shared-store method, not a login-only subset.

## Key Insights
- `rusqlite` bundled SQLite already present (`server/Cargo.toml:109`); no new SQL framework/daemon.
- PTY persistence already uses `Arc<Mutex<Connection>>`, but auth operations must not block Tokio.
- TOTP/challenge/session CAS requires database predicates across independent connections, not only a process-local mutex.
- Existing Mongo whole flows are multiple operations; parity does not imply cross-record transactional issuance.

## Requirements
- Dedicated auth file, transactional versioned migrations, exact username uniqueness and immutable ObjectId-compatible user IDs.
- Typed user/session/challenge columns including complete enrollment/step-up bindings.
- UTC i64 millisecond timestamps and checked record decoding; no fabricated recovery from corrupt data.
- All operations implemented, atomic conditional updates and throttle read-modify-write transaction.
- Startup fails on unsafe/unwritable/corrupt/newer-schema DB; runtime store errors fail closed.
- Validated deployment: one server process per auth file on local storage; no shared-network-file or multi-server qualification. Independent operator/test connections remain supported and must preserve CAS/throttle correctness.

## Architecture
Shared facade dispatches to `SqliteAuthStore` with cloneable connection handle. `spawn_blocking` encloses connection lock, transaction and result decoding; no synchronous locks across awaits. WAL, bounded busy timeout <=2s, safe durability. File version tracked via auth-only schema metadata/PRAGMA user_version in a dedicated DB. Record conversions stay adapter-local.

## Related code files
Modify:
- `server/src/auth/store.rs`: SQLite dispatch/open factory and used typed errors.
- `server/src/auth/mod.rs`: module exposure if needed.
Create:
- `server/src/auth/store/sqlite.rs`: open/migrate and CRUD/CAS methods.
- `server/src/auth/store/sqlite/records.rs`: typed row mapping only if main adapter exceeds repository size guidance; avoid unnecessary module.
- `server/src/auth/store/migrations/001-auth.sql`: schema/indexes/checks from contracts.
- `server/tests/auth_sqlite_store.rs`: meaningful file-backed boundary/CAS regressions in Phase 04.
Intentionally unchanged: existing session/workflow migrations, `auth/model.rs`, password/TOTP/policy modules, Cargo dependency set.

## Implementation Steps
1. Securely create private parent and auth file; reuse appropriate existing permission/no-follow handling. Reject nonregular final target; ensure WAL/SHM sidecars inherit owner-private directory protection. Propagate all errors.
2. Open inside blocking task. Apply WAL, foreign keys, busy timeout and durability; validate database identity and schema version. Apply initial schema atomically; reopened current schema idempotent; unknown newer schema errors.
3. Encode/decode shared BSON IDs/timestamps and typed enums explicitly. All-or-none confirmed MFA fields; nullable purpose-specific challenge values retained; version/counter arithmetic checked.
4. Implement exact parameterized lookup/INSERT methods. Generate ObjectId if new user has no ID; never `INSERT OR REPLACE`. Normalize username conflicts, preserving other failure errors.
5. Implement enrollment and accepted-step CAS. Existing legitimate callers only advance confirmed MFA; never synthesize a partial factor from absent MFA. Document/test safe no-match boundary versus Mongo legacy malformed absent-last-step state.
6. Implement account attempt window in IMMEDIATE transaction; compare injected `now` exactly with 600s window and cooldown. Clear all failed-state columns on success as current contract.
7. Implement atomic challenge increment/consume and session step-up update with updated-row return. Version mismatch, revoked or exact-expired row yields no-match; preserve original absolute expiry.
8. Implement single and bulk revocation returning affected counts. Preserve request-time expiry/version policy independently of storage cleanup.
9. Add bounded indexed expiry pruning on session/challenge create using record issue time and a fixed small batch (e.g. 256). No background sweeper/retry/retention redesign.
10. Join facade and adapter only when every method is real. Capture store outcomes for final qualification; no stubs or error suppression.

## Todo list
- [ ] Secure file open and versioned schema.
- [ ] Checked row/ID/timestamp conversion.
- [ ] Complete CRUD and CAS operations.
- [ ] Atomic persisted throttle and bounded expiry cleanup.
- [ ] File-backed independent-connection behavioral regressions.

## Success Criteria
- Database opens/reopens, all model fields round-trip semantically, writes survive restart.
- Duplicate account insertion cannot overwrite password/role/MFA; corrupt record denies lookup.
- Two independent connections: exactly one enrollment/challenge-consume/equal-step/session-version winner; stale version writes rejected.
- Concurrent attempt increments not lost; exact window/cooldown boundaries enforced by shared policy.
- Busy/unwritable/unsafe/newer-schema state cannot select another backend or authorize.

## Risk Assessment
WAL backup/permissions, blocking-task queue contention, partial multi-operation auth failures, mismatched enum/timestamp conversion. Mitigate with private directory, bounded busy timeout, checked conversion and real independent-connection tests. Preserve current cross-record operation ordering; do not claim atomic complete login transaction.

## Security Considerations
No plaintext secrets, session tokens or passwords persisted. Bind ciphertext/key/nonce to existing AES AAD. IDs immutable for operator recovery. Parameterized SQL; no case normalization or cascade removing unrelated user data.

## Next steps
Phase 03 selects this fully implemented backend and migrates all authorization consumers. Phase 04 runs final behavioral suites and live runtime smoke.
