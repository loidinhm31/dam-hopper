# Phase 01: V2 durable contract and atomic migration

## Context Links

- [Plan](./plan.md)
- [Commit/current-flow research](./research/researcher-01-commit-current-flow-report.md)
- [Security design research](./research/researcher-02-security-multi-connection-design-report.md)
- [Architecture decision](./reports/advisor-architecture-decision.md)
- [Established-connection architecture](../../docs/system-architecture.md#planned-established-connection-forwarding-model)
- Baseline symbols: `SshForwardProfile`/`ReconnectPolicy` in `profile.rs`; `StoredProfiles`, `StoredProfile`, `ScopeStore::load_profiles`, `ScopeStore::replace_profiles`, `SCHEMA_VERSION` in `store.rs`.

## Overview

- Date: 2026-08-16
- Description: Define credential-free v2 connection/rule models and safely migrate v1 combined profiles.
- Priority: P2
- Implementation status: Completed 2026-08-16
- Review status: Approved; medium revision-ambiguity note is non-blocking and remains covered by checked collection revisions/stale-write tests.

## Key Insights

- One v2 scope document with independent connection/rule collections and revisions gives a single atomic commit boundary; two files would require a new cross-file transaction protocol.
- V1 is fully credential-free, so migration can preserve data without handling secrets.
- V2 TOML remains credential-free. Thirty-day password/passphrase persistence belongs only to the Windows vault adapter in Phase 03.
- Stable rule IDs should retain v1 profile IDs. New connection IDs may be UUID v4 because the migration commits atomically; deterministic source ordering makes deduplication and field selection repeatable.
- A saved profile is not a known live connection. `Established` remains memory-only.

## Requirements

- Add persisted `SshConnectionProfile`: `id`, `scopeId`, `name`, canonical `sshHost`, `sshPort`, `sshUser`, auth identity (`agent` or safe `keyId`), timestamps. Keep host keys solely in the existing endpoint-first trust store.
- Add persisted `SshForwardRule`: `id`, `scopeId`, `connectionProfileId`, `name`, `localPort`, fixed `targetHost=127.0.0.1`, `targetPort`, desired-enabled intent, bounded reconnect policy, timestamps.
- Store v2 as `schema_version=2`, one scope ID, `connections_revision`, `rules_revision`, unique connection/rule IDs, valid references, max 64 saved connections and 64 rules. Runtime caps remain separate.
- Reject unknown fields, secrets, invalid UUIDs/counters/timestamps, duplicate binds/IDs, dangling references, noncanonical hosts, non-loopback targets, and ports outside `1..=65535`.
- Migrate v1 profiles sorted by `(createdAt,id)`. Preserve profile ID as rule ID. Deduplicate connections only by canonical `(scope,host,port,user,auth identity)`; copy the first name/timestamps without creating a second trust record or profile pin.
- Map `autoStart` to desired-enabled intent only. Scope activation must not auto-authenticate; rules open only after explicit establishment.
- Preserve each v1 rule's reconnect policy. Connection reconnect uses the bounded aggregate of currently enabled children later defined in Phase 3.

## Architecture

`profiles.toml v1 -> validate all -> map in memory -> validate v2 graph -> durable v1 rollback copy -> atomic replace profiles.toml v2 -> re-read/verify`.

- Run under existing feature runtime lease, scope activity lease, operation fence, and retained no-follow contained handles.
- Reuse replacement marker/fsync/rollback machinery. A failure before verified commit leaves v1 authoritative; a failure after marker recovery completes or rolls back on next open.
- Keep one v2 file so connection/rule references cannot become half-migrated. Separate revisions still allow stale CRUD rejection by collection.
- Retain `profiles.v1.rollback.toml` with protected permissions and checksum metadata for prior-binary rollback; treat it as managed recovery-only input, never live state.

## Related Code Files

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\profile.rs` — **modify**: replace combined durable shape with `SshConnectionProfile`, `SshForwardRule`, shared auth/reconnect/loopback validation.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\store_schema.rs` — **create**: v1 wire-only structs, v2 stored structs, graph validation, deterministic migration pure function.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\store.rs` — **modify**: v2 revisions/collections, migration admission, contained rollback artifact, atomic recovery, CRUD helpers.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\mod.rs` — **modify**: register private `store_schema` module.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` — **modify**: introduce collection revision types/DTO bases used by later IPC without adding commands yet.
- No files under `G:\ws\sharing\dam-hopper\server` — **no change**: forwarding remains native-only.

## Implementation Steps

1. Write v2 types and validators first. Centralize canonical identity and loopback/port rules; do not duplicate validation in store/manager.
2. Add `StoredScopeConfigV2` and private `StoredProfilesV1`; deny unknown fields and keep snake_case TOML/camelCase wire separation.
3. Implement `migrate_v1`: validate source before allocation, sort, deduplicate exact canonical identities, generate one connection UUID per identity, preserve rule IDs, and validate the result graph.
4. Split store access into `load_scope_config`, `replace_connections`, and `replace_rules`; each checks the expected collection revision, checked-increments only its revision, then atomically replaces the whole v2 document.
5. Integrate first-load migration with existing replacement markers, hard-link/reparse defenses, fsync order, recovery, scope purge, and managed-artifact enumeration.
6. Preserve the v1 rollback artifact only after byte-for-byte readback/checksum. Never auto-read it as current v2 state.
7. Add unit/property-style cases: one profile; many rules sharing identity; same host/different user/key/port; divergent reconnect settings; malformed/secret-bearing v1; duplicate IDs/binds; counter exhaustion; injected replacement faults; restart recovery; rollback artifact restore.
8. Document operational rollback in Phase 6: stopped app only, restore v1 artifact, then prior package. Do not implement in-process down-migration.

## Todo List

- [x] Define and validate v2 connection/rule models.
- [x] Add independent checked revisions in one atomic document.
- [x] Implement deterministic v1-to-v2 mapping.
- [x] Extend contained atomic recovery and purge allowlists.
- [x] Retain verified v1 rollback artifact.
- [x] Pass migration/fault/restart tests.

## Validation Record

- `cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml -- --check` — passed.
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::store_schema::tests --lib` — 4 passed, 0 failed.
- Targeted store tests for first-load migration/byte-exact rollback, atomic collection revisions, secret-bearing v1 rejection, tampered rollback recovery, incomplete rollback recovery, legacy compatibility round-trip, and stale compatibility write rebase — 7 passed, 0 failed.
- Compatibility façade verified: legacy round-trip preserves v2 `desired_enabled`; stale legacy writes rebase the current connection view; migration does not auto-start v2 rules.
- Rollback recovery verified: migration retains the byte-exact protected v1 artifact; tampered artifacts are rejected; incomplete artifacts are discarded when live v1 remains authoritative.
- Medium review note: collection revision ambiguity is non-blocking after separate checked revisions and stale-write coverage; broader packaged Windows/release validation remains Phase 06.

## Success Criteria

- Every valid v1 fixture yields a valid v2 graph with no lost port/auth/reconnect/enable intent.
- Same canonical identity shares one connection; different endpoint/user/auth identities never merge.
- Crash/fault injection exposes either intact v1 or complete v2, never mixed collections.
- No serialized document contains password, passphrase, decrypted key, live state, or runtime generation.
- Connection migration neither creates nor guesses a vault entry; credentials are saved only after a later successful authentication.
- Existing trust/meta revisions and scope retention semantics remain unchanged.

## Risk Assessment

- **High — irreversible upgrade:** retained v1 artifact plus stopped-app restore procedure.
- **High — incorrect dedupe:** exact tuple, deterministic ordering, identity-isolation tests.
- **High — filesystem recovery regression:** reuse retained-handle transaction machinery; exhaustive fault/reparse tests.
- **Medium — revision ambiguity:** separate counters, checked increments, exact stale-conflict errors.

## Security Considerations

- Treat all TOML as hostile. Validate before migration and again after serialization/readback.
- Never infer or duplicate trust from v1 presence; the endpoint-first trust store remains the only durable host-key authority.
- Protect rollback artifact with the same ACL/mode, no-follow, hard-link, containment, and scope checks as live data.
- Redact absolute paths and source errors from command errors/logs.

## Next Steps

- Phase 02 consumes only validated v2 models and store helpers.
- Do not expose v2 commands until runtime ownership and generations exist.

## Unresolved Questions

None.
