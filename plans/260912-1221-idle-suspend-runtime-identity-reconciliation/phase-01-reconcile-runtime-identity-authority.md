# Phase 01 — Reconcile runtime identity authority

## Context links

- [Plan](plan.md) · [Synthesis](reports/01-planning-synthesis.md) · [Runtime identity research](research/researcher-01-report.md)
- [Parent diagnostics plan](../260912-0027-production-idle-suspend-diagnostics/plan.md)
- [Planned architecture](../../docs/system-architecture.md#production-idle-suspend-diagnostics-planned-and-approved-phase-01)

## Overview

- Effort: 14h
- Date: 2026-09-12
- Description: hard-cut release manifests to v2, remove API manifest identity, and make the exact final rendered non-root unit pair the sole runtime identity authority.
- Priority: P2
- Implementation status: completed 2026-09-12
- Review status: approved 2026-09-12

## Key Insights

- The current shared schema version couples release manifests to persisted manager state. The constants must split before the release manifest moves to v2.
- API and web currently share a service contract although only web retains a manifest identity invariant. Separate types are the clean cutover.
- Current staging/activation/health paths can select `SUDO_USER`, infer group from username, rewrite late, or fall back to root. Every runtime consumer must instead parse the finalized unit.
- A v2-only consumer/producer is intentionally incompatible with old managers and v1 release assets. Operational sequencing, not a dual-read shim, manages the cutover.

## Requirements

- Define `RELEASE_MANIFEST_SCHEMA_VERSION = 2` and `MANAGER_STATE_SCHEMA_VERSION = 1`; migrate each consumer to the correct constant.
- Remove API `identity` from Rust manifest types, JSON Schema required/properties, generator output, fixtures, and validation. Delete `API_SERVICE_IDENTITY` and every import/reference. Do not leave serde aliases, optional fields, translation, dual-read, or deprecated comments.
- Reject schema v1 release manifests and v2 manifests containing API `identity`. Emit only v2. Preserve manager-state serialization/validation at v1.
- Retain web `identity` as required and enforce its existing exact value independently.
- Resolve `DEFAULT_API_SERVICE_USER` or explicit host/CLI selection once for rendering; verify user exists, UID is nonzero, primary group exists, and GID is nonzero. Use fixed home `/var/lib/dam-hopper`.
- Never select API identity from `SUDO_USER`; never substitute username for unresolved primary group.
- Finalize, strict-policy-validate, durably write, and hash pending/installed API/helper units before preflight. Start-time override updates unit, host selection, digest, and state atomically or fails before start.
- Parse exactly one `User=` and one `Group=` from the final unit. Resolve both against accounts, require group GID equals user's primary GID, and reject root name, UID 0, GID 0, missing, duplicate, or conflicting directives.
- `build_candidate_health_targets` receives caller `Layout`, uses pending or installed final unit as appropriate, and returns error rather than consulting manifest, host config, environment, defaults, or `(0,0)`.
- Preserve API/web bind/port/unit/health validation, unrelated systemd hardening, legacy format-2 isolation, and helper protocol/runtime/log behavior.
- Define the release gate: manager-first deployment, v2 forward and rollback manifests regenerated/signed, forward+rollback qualification under the v2 manager, no publication to mixed manager capability, and no manager downgrade while v2 assets are active.

## Architecture

- `ApiServiceContract` contains unit/bind/port/health only. `WebServiceContract` additionally contains its enforced identity. `ServicesMeta` composes them without compatibility fields.
- Render flow: configured/default selection → account/primary-group resolution → concrete render context → strict unit policy → durable write/digest. Runtime flow: transaction-scoped or installed final unit → exact parse → account resolution → health/provisioning.
- A narrow `ApiRuntimeIdentity { user, group, uid, gid }` may be constructed from selected identity for rendering and independently from `ParsedUnit` for runtime use; runtime APIs accept only the latter result.
- Pending preflight reads the transaction final unit. Active start, recovery, and rollback read the installed final unit through supplied `Layout`; no hidden global layout or identity fallback.
- Clean compatibility boundary: v2 parser rejects v1 and unknown API `identity`; v1 manager rejects v2. Deployment sequencing is explicit rather than encoded as a translation layer.

## Related code files

| Action | Absolute path | Intended symbol/change | Dependency |
| --- | --- | --- | --- |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/constants.rs` | Delete `API_SERVICE_IDENTITY`; split manifest v2 and manager-state v1 constants | None |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/state.rs` | Use manager-state v1 constant only | Constants split |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/manifest.rs` | Split API/web contracts; remove API identity field | Constants split |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/manifest_validation.rs` | Require manifest v2; delete API identity validation; retain web identity and other invariants | Contract split |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/account.rs` | Exact user/primary-group selection and parsed-unit resolution; reject UID/GID zero | None |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/unit.rs` | Require resolved identity in API render context; remove implicit defaults | Account resolver |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/unit_policy.rs` | Require one exact non-root API `User=`/`Group=` pair | Unit render context |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/stage_units.rs` | Remove `SUDO_USER`/group fallback and late authority; finalize before digest | Account resolver |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/stage_transaction.rs` | Persist digest/state only for final validated unit bytes | Staging flow |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/activate.rs` | Replace best-effort late rewrite with fail-closed finalized-unit operation | Staging flow |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/activate_preflight.rs` | Derive health UID/GID only from exact final unit under caller `Layout` | Parsed-unit resolver |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/rollback.rs` | Supply restored installed-unit identity to health/start pipeline | Resolver signature |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/linux_release/mod.rs` | Clean exports; no compatibility aliases | All Rust changes |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/release/release-manifest.schema.json` | Set v2; remove API identity property/requirement; retain web identity | Contract decision |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/release/generate-release-manifest.mjs` | Emit manifest v2 with no API identity | JSON Schema |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/common/release_fixtures.rs` | Generate v2-only split service contracts | Manifest types |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_manifest.rs` | v2 round-trip; state v1 independence; v1 rejection | Manifest validation |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_manifest_errors.rs` | Reject API identity/old version; retain web identity rejection | Manifest validation |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_unit_policy.rs` | Default/custom and root/duplicate/group mismatch matrix | Identity resolver |
| Modify | `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/linux_release_staging.rs` | Final bytes/digest and no fallback/late rewrite | Staging flow |

## Implementation Steps

1. Split the shared version constant and migrate manifest/state consumers. Add focused evidence that manifest v2 and manager state v1 coexist.
2. Split service contracts; remove API identity from serialization, schema, generator, constructors, validation, imports, and fixtures in one clean cutover. Preserve web identity validation.
3. Make strict v2 parsing reject version 1 and reject an API `identity` member as unknown. Add no v1 reader or conversion path.
4. Add exact account and primary-group resolution. Make default/custom selection deterministic and non-root; remove `SUDO_USER`, username-group, and root fallbacks.
5. Require concrete identity in render context; tighten policy to exact non-root `User=`/`Group=` and preserve unrelated directives.
6. Finalize unit bytes before durable hash/state commit. Replace activation's best-effort late rewrite with an all-or-nothing update that starts nothing on failure.
7. Replace health fallback resolution with final-unit parsing and migrate activation, recovery, automatic rollback, and modern manual rollback callers to pass `Layout`.
8. Update producer/fixtures and release contract tests for v2 only. Remove obsolete v1/root/API-identity tests rather than repinning them.
9. Record the operational cutover runbook in existing release documentation during Phase 03: deploy manager first, regenerate/sign candidate and rollback manifests as v2, qualify application rollback under v2 manager, block manager downgrade and mixed-capability publication.

## Todo list

- [x] Split release-manifest v2 from manager-state v1.
- [x] Remove API manifest identity and constant without shims.
- [x] Resolve/render exact default/custom non-root identity.
- [x] Make final unit the only health/provisioning identity input.
- [x] Finalize units and digests before preflight.
- [x] Define and test the v2 publication/rollback gate.

## Completion record

- Implementation completed 2026-09-12.
- Final review approved after bounded corrections; no blocker/high finding remains.
- Validation passed: `cargo check --tests`, focused release suites, adjacent release regressions, deployment fixture smoke, and archive/manifest smoke.
- Phase 03 qualification/runbook work remains pending.

## Success Criteria

- Generator/schema/parser/fixtures emit and accept release manifest v2 only; v1 and v2 API `identity` fail cleanly. Manager state v1 remains readable/writable. Web identity drift still fails.
- No `API_SERVICE_IDENTITY`, API manifest identity field, serde alias, dual-read, conversion, or fallback remains.
- Default/custom units contain one exact non-root `User=`/`Group=`; root aliases, UID/GID zero, missing/duplicate directives, primary-group mismatch, render-context mismatch, or final-unit/live-process mismatch fail before successful start/health.
- Health target UID/GID comes only from the applicable final unit under supplied `Layout`.
- Release acceptance documents that old managers cannot consume v2, requires a v2 rollback manifest, and prohibits manager downgrade during the v2 window.
- Narrow verification: `cargo test -p dam-hopper-server --test linux_release_manifest`; `cargo test -p dam-hopper-server --test linux_release_manifest_errors`; `cargo test -p dam-hopper-server --test linux_release_unit_policy`; `cargo test -p dam-hopper-server --test linux_release_staging`.

## Risk Assessment

- Publishing v2 before manager rollout strands targets: gate publication on a verified homogeneous v2-capable manager fleet.
- Application rollback could reference v1 assets: regenerate/sign and qualify the designated rollback release as v2 before publication.
- Manager downgrade after v2 acquisition cannot parse current assets: explicitly prohibit it; rollback applications through the v2 manager.
- Finalized unit/hash/config can diverge if written separately: commit through existing transaction boundaries and start nothing on partial failure.
- Custom user's primary group may differ from username: resolve by GID and test explicitly.

## Security Considerations

- Reject root by both names and numeric UID/GID; do not silently map old root metadata to a non-root account.
- Error messages identify fixed field/directive and account name only; do not dump passwd/group records or environment.
- Strict unknown-field rejection prevents a removed API identity from retaining hidden semantics.
- Preserve all unrelated API/helper unit hardening.

## Next steps

Proceed to Phase 02 only after v2 contracts and final-unit identity interfaces are coherent; Phase 02 consumes the parsed-unit identity and must not read manifest or host selection.

## Unresolved questions

None.
