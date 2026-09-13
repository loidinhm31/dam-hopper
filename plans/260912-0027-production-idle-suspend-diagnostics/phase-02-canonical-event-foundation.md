# Phase 02 — Canonical event writer, identity, sequence, correlation foundation

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 01](phase-01-freeze-architecture-contracts.md)
- [Event/audit research](research/researcher-01-event-audit-contract.md)
- `server/src/idle_suspend/server_audit.rs` · `server/src/idle_suspend/mod.rs` · `server/src/diagnostics/store.rs`

## Overview

- Date: 2026-09-12
- Description: implement the separately tagged server event schema and hardened writer, with process/boot identity, checked producer sequencing, and UUID correlation primitives.
- Priority: P1
- Implementation status: completed (2026-09-13)
- Review status: reviewed (score: 9.5/10, approved with minor recommendations)
- Progress: 100% (6/6 todo items).
- Effort: 16h
- Ownership: idle-suspend event owner exclusively edits new `event.rs`, `idle_suspend/mod.rs`, and event-focused tests. Phase 03 does not edit them concurrently.
- Dependency: Phase 01 approved architecture and exact path contract.

## Key Insights

- Existing `IdleSuspendServerAudit::record_raw` supplies useful mode/no-follow/sync precedent but its untagged records cannot host canonical events.
- Wall time is evidence only. Ordering authority is `(bootId, producerInstanceId, producerSequence)`.
- A consumed sequence on every emission attempt makes recovered write failures observable as gaps; restart creates a new producer identity and sequence 1.
- Correlation must be UUID v4-shaped and protocol-v1-valid without prefixes.

## Requirements

- Create deny-unknown-fields camelCase `IdleSuspendEventEnvelopeV1`, closed event/reason/mode/data enums exactly matching the contract.
- `ProducerIdentity` reads and strictly parses bounded `/proc/sys/kernel/random/boot_id`, creates one UUID v4 instance ID, and never uses hostname, PID, epoch, or revision as identity.
- `IdleSuspendEventWriter` owns fixed path, identity, mutex, and checked sequence. Append one bounded JSON line with mode `0600`, `O_NOFOLLOW`, newline, and `sync_data`.
- Reject serialization over 16 KiB before write. Sequence overflow disables future emission; never wrap/reuse.
- Validate action correlation as unprefixed UUID v4 and confirm `protocol::validate_request_id` accepts its string.
- Writer failures return typed, privacy-safe `EventWriteError`; caller decides whether evidence is best effort. Writer contains no coordinator policy.
- Preserve `ServerAuditRecord`, `IdleSuspendServerAudit`, timing/manual bytes/readers unchanged.
- Tests use temp paths/fake boot ID and deterministic injected identity/clock; no production paths or services.
- Non-goals: coordinator/helper instrumentation, helper audit evolution, collector/bundle, general logging abstraction, async queue, daemon.
- Rollback: remove module/export and stop constructing it later; existing audit and protocol behavior remain byte-compatible, event file left untouched.

## Architecture

- New `server/src/idle_suspend/event.rs` owns `IDLE_SUSPEND_EVENT_SCHEMA_VERSION`, `ServerIdleSuspendEventTypeV1`, `ServerIdleSuspendReasonCodeV1`, `IdleSuspendEventDataV1`, `IdleSuspendModeV1`, `ProducerIdentity`, `IdleSuspendEventEnvelopeV1`, `IdleSuspendEventWriter`, and `EventWriteError`.
- `IdleSuspendEventWriter::emit(timestamp_ms, event_type, correlation_id, mode, data)` validates event/data pairing, consumes the next sequence under one lock, serializes, appends, syncs, and returns the immutable envelope.
- `IdleSuspendEventWriter::new` is production construction; `with_identity_and_clock` or an equivalent crate-private constructor is the deterministic seam. Avoid a generic writer framework.
- Event payload variants carry only fields relevant to that event. Revisions/generations/counts are bounded primitives; no map/free-form string payload.
- Default path helper resolves the deployed API diagnostics directory and is asserted against `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl` under deployed environment fixtures.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Create | `server/src/idle_suspend/event.rs` | Schema enums/envelope, identity, UUID validator, hardened synchronized writer, typed errors | Phase 01 contract |
| Modify | `server/src/idle_suspend/mod.rs` | Declare/re-export only required event types/writer/constants | New module complete |
| Modify | `server/src/idle_suspend/tests.rs` | Observable serde, bounds, mode/no-follow/sync behavior, sequence/restart/gap, UUID/protocol compatibility tests | New module |
| Inspect only | `server/src/idle_suspend/server_audit.rs::{ServerAuditRecord,IdleSuspendServerAudit}` | Reuse security pattern; prove no schema/behavior change | None |
| Inspect only | `server/src/diagnostics/store.rs::default_diagnostics_log_path` | Align deployed parent path without coupling writers | Phase 01 path |
| Delete | None | Existing audits/aliases remain | — |

## Implementation Steps

1. Add exact constants and closed enums; encode event/data compatibility in constructors so invalid combinations cannot serialize.
2. Add strict UUID v4 correlation newtype using existing `uuid`; provide string view for helper protocol without allocating repeatedly on hot paths where avoidable.
3. Implement boot-ID reader with 128-byte cap, regular-file/no-follow read, whitespace trim, UUID validation. Production initialization failure is typed, never a sentinel.
4. Implement writer state under one `parking_lot::Mutex`: identity, next sequence, disabled-on-overflow state. Reserve sequence before serialization/I/O.
5. Open append/create/write with Unix `0600` and `O_NOFOLLOW`; bound line, write all plus newline, `sync_data`. Refuse symlink/non-regular targets and unsafe parent ownership per Phase 01.
6. Add deterministic constructor accepting fake clock/identity/path. Avoid filesystem-global environment mutation in parallel tests.
7. Add behavior tests: exact tagged JSON round trip; unknown field/event rejection; invalid event/data/UUID; 16-KiB boundary; file mode; symlink rejection; sequences 1/2; injected failure then sequence gap; new instance restarts at 1; overflow rejection; audit bytes unchanged.
8. Run focused commands after implementation: `cargo test -p dam-hopper-server idle_suspend::tests::event_` and the existing server-audit focused tests. Review allocation/lock scope and error privacy.

## Todo list

- [x] Add closed event model and correlation newtype.
- [x] Add producer identity and checked sequence allocation.
- [x] Add bounded mode-0600 no-follow synced writer.
- [x] Add deterministic observable-contract tests.
- [x] Verify existing untagged audit remains untouched.
- [x] Complete focused security/code review.

## Success Criteria

- Two writes from one producer serialize sequences 1 then 2; a new instance restarts at 1 with a different UUID; a failed attempted write causes a visible later gap.
- Invalid schema/event/data/UUID, overlong line, symlink target, and sequence overflow fail closed with typed sanitized errors.
- File is regular mode `0600`; successful call returns only after `sync_data`.
- Existing timing/manual audit readers still consume their fixtures unchanged.
- Focused command `cargo test -p dam-hopper-server idle_suspend::tests::event_` passes; no test accesses production RTC, services, logs, or config.
- Review gate approves public/type surface before Phase 03 uses it.

## Risk Assessment

- Disk sync on semantic events adds coordinator latency: Phase 03 emits only boundaries and keeps disk I/O outside manager/coordinator locks; measure focused path, do not add a queue without evidence.
- Sequence hidden after terminal write failure: open chain/missing outcome still yields partial evidence; never synthesize a marker not persisted by the producer.
- Environment-dependent path tests race: inject path/environment resolution inputs instead of mutating process environment.
- Schema enum growth: require current branch ownership and collector need; no generic payload map.

## Security Considerations

- Writer rejects symlinks/non-regular files and constrains permissions/line size before allocation/write.
- Event constructors accept no free-form operational text or actor identity.
- Boot/producer/action UUIDs are opaque identifiers, not secrets; strict syntax prevents source injection.
- Errors expose codes/fixed path labels, never serialized payload or OS detail to bundles.

## Next steps

Phase 03 injects one writer into coordinator startup and uses the correlation newtype across automatic/manual action lifecycles. Phase 04 may consume the correlation string only after Phase 03 freezes dispatch behavior.

## Unresolved questions

None. Any need for a new event/payload returns to Phase 01 schema review.
