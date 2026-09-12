---
title: "Idle-suspend runtime identity reconciliation"
description: "Cut release manifests to v2, make rendered API identity authoritative, and fail closed on unsafe runtime paths before every API start."
status: in_progress
priority: P2
effort: 40h
branch: feat/terminal-idle-suspend
tags: [linux-release, systemd, identity, provisioning, idle-suspend]
created: 2026-09-12
---

# Idle-suspend runtime identity reconciliation

## Objective

Remove the conflicting manifest/runtime identity authority. The final rendered `dam-hopper-api.service` `User=`/`Group=` pair alone determines runtime UID/GID, health expectations, and ownership required for API runtime paths. A single fail-closed provisioner creates missing paths and validates existing paths before every API start without repairing operator-managed mismatches.

## Read first

- [Planning synthesis](reports/01-planning-synthesis.md)
- [Runtime identity research](research/researcher-01-report.md)
- [Provisioning research](research/researcher-02-report.md)
- [Parent diagnostics plan](../260912-0027-production-idle-suspend-diagnostics/plan.md)
- [Planned architecture](../../docs/system-architecture.md#production-idle-suspend-diagnostics-planned-and-approved-phase-01) — lines 496–520 and 663–673 are planned, not implemented fact.

## Validation decisions

1. **Hard manifest v2 cutover.** Split `RELEASE_MANIFEST_SCHEMA_VERSION = 2` from `MANAGER_STATE_SCHEMA_VERSION = 1`; remove API `identity` and `API_SERVICE_IDENTITY` entirely. Generator, JSON Schema, Rust parser, fixtures, and tests emit/accept v2 only. Web identity remains required and enforced. No v1 dual-read, translation, alias, or deprecation shim.
2. **Explicit compatibility gate.** Old managers cannot consume v2 releases. Roll out and verify the v2-capable manager before publishing v2 manifests; regenerate/sign the forward and rollback release manifests as v2; prohibit manager-binary downgrade while v2 assets are active. Application rollback continues through the v2 manager and a prequalified v2 rollback manifest.
3. **One pre-start gate.** Preserve `Restart=on-failure`. The API unit contains exactly one fixed root-privileged, zero-operand `ExecStartPre` for the packaged command `bin/dam-hopper-manager provision-api-runtime` (rendered as `+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime`); explicit manager starts call the same provisioner before starting services.
4. **Refuse, do not repair.** Securely create absent managed paths. For every pre-existing managed object, reject owner/group/mode/type mismatch without `chown`, `chmod`, replacement, truncation, or content mutation. Report fixed path plus expected/current metadata safely; start nothing. Operator repairs manually, then reruns.
5. **Single state-path authority.** Remove `StateDirectory=dam-hopper` and `StateDirectoryMode=` from both API and helper units. The provisioner exclusively creates/validates the three API-owned state directories as `0700`. The root helper must not claim `/var/lib/dam-hopper`; its runtime/log directories, hardening, protocol v1, and behavior remain unchanged.
6. **Bounded rollback.** On provisioning-call failure, clean up only empty objects created by that call, in reverse order, and only while their recorded identity/type still match; cleanup identity/type drift fails closed. Never mutate or remove a pre-existing object. Existing transaction rollback/recovery still governs release state and reparses restored units before any restart.

## Authority and scope

Host config and CLI selection are render inputs only. Resolve the selected non-root user and primary group, render and durably validate exact `User=`/`Group=`, then re-derive numeric UID/GID from the final unit for health and provisioning. No manifest, host-config, `SUDO_USER`, username-as-group, or `(0,0)` runtime fallback.

Managed objects:

- `/var/lib/dam-hopper` — API UID/GID, directory, `0700`
- `/var/lib/dam-hopper/.config` — API UID/GID, directory, `0700`
- `/var/lib/dam-hopper/.config/dam-hopper` — API UID/GID, directory, `0700`
- `/etc/dam-hopper/idle-suspend-audit.jsonl` — API UID/GID, regular file, `0600`, existing bytes/inode preserved

`/etc/dam-hopper` is a fixed root-owned (`0:0`) directory anchor with mode `0755`, created safely if absent and otherwise validated without repair. No diagnostics Phase 02, observer, upload, telemetry, UI, helper Rust/protocol/audit change, suspend/RTC action, idle-suspend policy change, generic filesystem framework, arbitrary paths, or legacy format-2 reinterpretation.

## Ordered phases

| Phase | Status | Progress | Effort | Outcome |
| --- | --- | ---: | ---: | --- |
| [01 — Reconcile runtime identity authority](phase-01-reconcile-runtime-identity-authority.md) | completed | 100% | 14h | Manifest v2 hard cutover; exact final-unit non-root identity is sole runtime authority; focused release suites and review passed |
| [02 — Provision API runtime paths](phase-02-provision-api-runtime-paths.md) | completed | 100% | 18h | Completed 2026-09-12: refusal-based no-follow provisioning uses final-unit identity, gates explicit/rollback starts and automatic restarts, and provisions active server recovery before success without starting services |
| [03 — Qualify and review reconciliation](phase-03-qualify-and-review-reconciliation.md) | pending | 0% | 8h | Observable matrices, migration gate, architecture/security/release approval |

## Cross-phase acceptance gate

- v2 is the only accepted/emitted release manifest; API `identity` and `API_SERVICE_IDENTITY` have no schema, Rust, generator, fixture, test, or documentation residue. Manager state remains v1; web identity enforcement remains intact.
- Default/custom final-unit identities work; root name, UID 0, GID 0, missing/duplicate directives, primary-group mismatch, render-context mismatch, and live-process mismatch fail closed.
- Missing managed paths are created with exact identity/type/mode. Any pre-existing mismatch, symlink, or special file is rejected with no mutation and zero starts; after explicit operator repair, rerun succeeds.
- Existing audit bytes/inode are preserved. Failure cleanup removes only call-created empty objects whose recorded identity/type still match; cleanup races fail closed. Explicit activation and rollback provision first; boot recovery provisions an active server before success but does not start services; restored units are revalidated before rollback start; the fixed `ExecStartPre` closes automatic `Restart=on-failure` bypass, and the audit consumer is pre-provisioned/no-follow.
- Neither API nor helper unit uses `StateDirectory=dam-hopper`; helper runtime/log ownership, hardening, protocol v1 bytes, and behavior are unchanged.
- Parent diagnostics Phase 02 remains blocked until focused evidence and architecture/security/release-owner review approve the implemented contract.

## Rollback and release gate

This is an intentional compatibility break. A v2 release is not consumable by an old manager, and the new manager does not accept v1 release manifests. Before channel publication: deploy/verify the new manager everywhere, regenerate and sign both forward and rollback manifests as v2, exercise the rollback release with the v2 manager, and block old-manager downgrade. Runtime rollback restores prior units/binaries under the v2 manager, reparses the restored API unit, and reruns refusal-based provisioning before start. A path mismatch stops rollback start and requires operator repair; no provisioning repair is attempted.

## Unresolved questions

None.
