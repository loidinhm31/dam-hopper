# Phase 07 — Format-2 Migration and Old Runner Retirement

## Context Links

- [Parent plan](./plan.md)
- [Phase 05 transaction runtime](./phase-05-durable-activation-rollback-recovery.md)
- [Phase 06 publisher/bootstrap](./phase-06-central-github-publisher-bootstrap.md)
- [Accepted brainstorm](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md)
- [Current production runner](../../deploy/run-linux-production.sh)
- [Current reset workflow](../../deploy/reset-linux-production.sh)
- [Current deployment fixtures](../../tests/deploy/linux-production-fixtures.sh)

## Overview

- **Date:** 2026-09-03
- **Description:** Import one verified healthy format-2 server installation as rollback-capable previous state, then remove the checkout-built production path after migration coverage passes.
- **Priority:** P1
- **Implementation status:** DONE 2026-09-04 02:40:00 +07:00
- **Review status:** DONE 2026-09-04 02:40:00 +07:00 (Review Cycle 2 Passed; Score: 9.0/10)
- **Progress:** 100% (11/11 implementation steps; 13/13 todo items)

## Key Insights

- Current install rejects existing `/opt`/unit state, so normal upgrade cannot be bolted onto the shell runner. Migration belongs in the new durable manager.
- Adding `.staging` inside the exact format-2 root would itself violate its marker inventory. Migration must stage beside `/opt/dam-hopper` on the same filesystem.
- The old running executable/unit must remain byte-for-byte unchanged until explicit activation. A root-directory exchange after quiescence allows deterministic restoration.
- Compatibility is bounded to the one known format-2 layout. Format 1 and unknown/drifted states fail closed; carrying their parsers into permanent production would create a second state machine.

## Requirements

### Functional

- Detect the exact format-2 root, marker, nonce, binary hash, unit hash, owner/mode/no-link inventory, wants link, unit properties, user runtime boundary, process identity, wildcard `4801` listener, free `4800/4802`, and API health version.
- Migration eligibility requires current `dam-hopper.service` active and healthy as `loidinh`; inactive, failed, partial, format-1, changed, or ambiguous state is rejected before mutation.
- `install --bundle` on eligible format-2 state copies exact old binary/unit/marker evidence into a manager-owned legacy previous release and stages the public candidate beside the old root. It does not stop or alter old health.
- Activation quiesces old service, records pre-state, atomically exchanges old and new roots on `/opt`, replaces the unit, then follows Phase 05 probing/commit.
- Candidate failure or crash before commit restores the old root, exact old unit/enablement, process, listener, and health.
- Successful migration preserves `/home/loidinh/.config/dam-hopper` byte ownership/content and records legacy previous provenance as imported/non-public.
- After a later successful public upgrade, normal retention may remove the imported legacy previous only when unreferenced and verified.
- Remove checkout-built production scripts, format-1 cleanup behavior, fixed old unit, and package script aliases only after replacement tests and Fedora migration rehearsal pass.

### Non-functional

- Use Linux same-filesystem atomic directory exchange (`renameat2(RENAME_EXCHANGE)`) with explicit capability/error handling; no copy/delete switch.
- Migration workspace is `/opt/.dam-hopper-migration.<txn>` root-owned `0700`; state records both sides and their hashes before exchange.
- No reset/purge is part of migration. Runtime config/state, repositories, containers, and MongoDB remain outside every mutation set.
- New production code contains no fallback parser or writer for format 1 after retirement.

## Architecture

Before activation:

```text
/opt/dam-hopper                         exact running format-2 root
/opt/.dam-hopper-migration.<txn>        complete new root
  releases/imported-format-2/server/    verified copy of old binary/unit evidence
  releases/vX.Y.Z/<role>/               selected candidate
/var/lib/dam-hopper-manager/state.json  pending migration transaction
```

After stop and durable `QUIESCED`, `renameat2(..., RENAME_EXCHANGE)` swaps the two directories. A crash on either side of the state write is classified using transaction IDs and root markers, not path assumptions. Candidate concrete units are installed only after the exchange. Rollback exchanges roots back and restores the exact old unit backup. On commit, the new root stays canonical; the old root copy becomes the imported previous release, and the exchanged original is removed only after equivalence verification.

The management CLI remains at `/usr/local/bin/dam-hopper` during rollback because legacy format 2 had no manager. This is a declared one-time migration exception, not mixed public component versions.

## Related Code Files

### Create

- `server/src/linux_release/legacy_format2.rs` — read-only exact format-2 verifier/import model.
- `server/src/linux_release/migration.rs` — side-stage, exchange, restore, and commit cleanup.
- `server/tests/linux_release_format2_migration.rs` — exact known-state and drift matrix.
- `tests/deploy/fedora44-format2-migration.sh` — real administrator migration/rollback rehearsal.

### Modify

- `server/src/linux_release/stage.rs` — select side-stage when exact legacy root owns canonical path.
- `server/src/linux_release/activate.rs` — migration exchange boundary.
- `server/src/linux_release/rollback.rs` — restore old root/unit/enablement.
- `server/src/linux_release/recovery.rs` — classify pre/post-exchange crashes.
- `server/src/linux_release/retention.rs` — imported previous equivalence and later cleanup.
- `server/src/linux_release/state.rs` — bounded migration metadata.
- `server/src/linux_release/mod.rs` — expose migration verifier.
- `package.json` — remove `linux:production` and `linux:reset` after replacement gates; add only new release validation entrypoints if still useful to contributors.

### Delete

- `deploy/run-linux-production.sh` — old build/install/start/status/rollback state machine.
- `deploy/reset-linux-production.sh` — checkout-dependent destructive reset path; runtime state becomes preserved/operator-owned, not install input.
- `deploy/systemd/dam-hopper.service` — old fixed single unit.
- `tests/deploy/linux-production-fixtures.sh` — format-1/2 runner fixture superseded by focused Rust and Fedora acceptance coverage.

## Implementation Steps

1. Port only the current format-2 verification invariants into a read-only parser: exact four-line marker, nonce/hash set, root/bin/marker inventory, unit/wants ownership, and no links/extras.
2. Require active healthy old service and capture exact API version, PID/executable/UID, unit bytes/hash, enablement, listener, runtime state metadata, and filesystem device ID.
3. Build a complete new root in a root-only sibling directory on the same device. Copy/import old assets and prove hashes/modes equal while leaving canonical paths untouched.
4. Write pending migration state and prove old PID, listener, health, unit, and root hashes remain unchanged after install.
5. During activation, stop old, prove cgroup/listener/SQLite clear, record `QUIESCED`, exchange directories, record boundary, install candidate unit/config, and use normal health gate.
6. Exercise failure immediately before/after exchange, before/after unit replacement, during both-role start, during probe, and during commit. Recovery must restore the old exact state or fail closed without deleting either root.
7. On success, verify imported legacy previous equals original exchanged root before removing the redundant original. Preserve imported previous for one rollback generation.
8. Reject format 1 with explicit unsupported migration guidance; do not call old destructive rollback automatically. Reject all unknown/drifted states with zero mutation.
9. Run scoped replacement tests and actual Fedora 44 migration rehearsal. Only after tester/reviewer evidence, delete old scripts/unit/fixture and remove package aliases in the same cutover.
10. Plan compile/static proofs: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`; `jq empty package.json`; `bash -n tests/deploy/fedora44-format2-migration.sh`.
11. Submit to `evcrate-code-reviewer`; fix blocking findings and rerun proofs/migration tests before terminal approval.

## Todo List — DONE 2026-09-04 02:40:00 +07:00

- [x] Add exact read-only format-2 verification/import.
- [x] Add same-filesystem side-stage and atomic root exchange.
- [x] Add crash-safe old root/unit restoration.
- [x] Add real known-state/drift/migration coverage.
- [x] Rehearse upgrade and rollback on Fedora 44.
- [x] Fix review findings:
  - [x] Retention `validate_tag_format` rejection of `imported-format-2`
  - [x] Activation transaction ID ownership conflict with staged migration
  - [x] Rollback unit backup path referencing deleted destination instead of backup
  - [x] Invariant enforcement: root/bin/marker inventory completeness, wants link target validation, and process UID/wildcard listener checks
  - [x] Post-commit manual rollback binary availability at `/opt/dam-hopper/bin/dam-hopper-server`
- [x] Delete old runner/reset/unit/fixture and package aliases only after gate.
- [x] Run compile/static checks and pass reviewer gate (Review Cycle 2).

## Success Criteria

- Eligible running format-2 install remains PID/executable/listener/health-byte equivalent after `install`; only pending manager paths are added outside its root.
- Candidate success commits one public version and retains a verified imported previous; runtime tree content/owner/mode digest is unchanged.
- Candidate failure and every exchange/unit crash point restore the exact old unit hash, root hash, enablement, `loidinh` process, `4801` listener, and API health version.
- Format-1, malformed marker, altered binary/unit, extra file, symlink, wrong owner/mode, unexpected wants link/drop-in, foreign process/listener, and unhealthy old service each fail before mutation.
- No implementation caller, package script, CI job, docs command, or test references deleted production scripts/unit after Phase 09.
- Permanent production has one Rust manager state machine; no compatibility alias, format-1 parser, or parallel shell install path remains.
- Compile/static commands exit `0`; reviewer has no unresolved P1/P2 findings.

## Risk Assessment

- **Atomic exchange unavailable:** Profile preflight rejects the host before migration; no non-atomic fallback.
- **Crash around exchange:** Durable transaction IDs in both roots plus pre-state backups make direction observable.
- **Old service unhealthy:** Refuse takeover; do not bless an unverified rollback target.
- **Reset workflow removal surprises operators:** Phase 09 replaces docs with explicit state ownership/recovery and backs changelog breaking change.
- **Imported version not public SemVer:** Mark typed `importedFormat2`; allow only as one previous target, never publisher input.

## Security Considerations

- Migration trusts only current marker after independently hashing bytes and validating live process/unit identity.
- Root exchanges and cleanup operate on fixed directory descriptors/same device and never follow links.
- User runtime is read for ownership/holder evidence only; no content is copied into releases, manifests, logs, or reports.
- Deletion occurs only after equivalence and unreferenced-state proof; ambiguity retains evidence.

## Next Steps
Proceed to Phase 08 behavioral, security, and failure validation. Non-blocking Cycle 2 hardening suggestions remain follow-up items; the migration and legacy runner retirement gate is complete.

### Unresolved Questions
None.
