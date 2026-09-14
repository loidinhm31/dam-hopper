---
title: "System daemon state configuration migration"
description: "Move production API configuration and adjacent server audit from /etc into refusal-provisioned daemon state under /var/lib/dam-hopper."
status: in-progress
priority: P2
effort: 44h
branch: feat/terminal-idle-suspend
tags: [linux-release, systemd, configuration, security, migration]
created: 2026-09-14
---

# System daemon state configuration migration

## Objective

Make `/var/lib/dam-hopper/dam-hopper.toml` the sole production API configuration. `api_runtime.rs` safely seeds or copy-once migrates it using the final rendered API identity; the unprivileged server then owns normal atomic updates. Move the coupled server audit to `/var/lib/dam-hopper/idle-suspend-audit.jsonl`. Keep `/etc/dam-hopper` root-owned and free of active API-owned state.

## Status

- **Plan:** in-progress (3/4 phases complete; 30/44h; updated 2026-09-14 19:17:04 +07:00).
- **Phase 01:** DONE (2026-09-14; 100%; 18/18h). Focused runtime/layout and diagnostics evidence is recorded in the [test report](../reports/tester-260914-1417-phase01-layout-runtime-provisioning.md) and [code review](../reports/code-review-260914-1421-phase01-layout-runtime-provisioning.md).
- **Phase 02:** DONE (2026-09-14 19:17:04 +07:00; 100%; 6/6h). Template, checked-in unit, rendered policy, and staging aligned on canonical ExecStart; focused unit-policy/staging gates passed 29/29; [cycle-2 review](../reports/code-review-260914-1805-phase02-systemd-unit-template-and-policy-cycle2.md).
- **Next:** Phase 03 — Preflight, scripts, and smoke tests.

## Read first

- [Scout report](agent://ScoutConfigUsage)
- [Research report](../reports/researcher-260914-0854-daemon-state-config.md)
- [Parent runtime identity plan](../260912-1221-idle-suspend-runtime-identity-reconciliation/plan.md)
- [Current architecture](../../docs/system-architecture.md#fixed-source-output-and-completeness-model-phase-06-implemented)

## Decisions and boundaries

1. Canonical wins. A valid pre-existing canonical file is read-only to provisioning; legacy is not consulted for migration.
2. Legacy-only copy is exact bytes, accepted only from a no-follow regular root-owned `0644` file at or below 64 KiB with valid UTF-8/TOML and absolute project roots. Unsafe legacy state refuses; no default masks it.
3. Both absent seeds exactly `[workspace]\nname = "default"\n`. Creation uses a fixed exclusive temporary file, descriptor writes/sync, exact API UID:GID `0600`, and no-replace install.
4. Audit follows config-parent coupling to `/var/lib/dam-hopper/idle-suspend-audit.jsonl`; legacy `/etc` audit is never deleted or repaired automatically.
5. Runtime provisioning may create/validate fixed `/var/lib/dam-hopper` objects only. Installer, preflight, unit rendering, reset tooling, and readers do not provision them.
6. Rootless/dev explicit `--config` behavior, generic config discovery, format-2 fixtures, helper audit, and `/etc` environment/host metadata remain outside path selection changes.

## Roadmap

| Phase | Status | Effort | Outcome |
| --- | --- | ---: | --- |
| [00 — Merge origin/main and reconcile conflicts](phase-00-merge-origin-main-and-reconcile-conflicts.md) | completed (2026-09-14; ready to commit) | 6h | origin/main merged; activate.rs chown discarded; docs-manager synthesizes all 10 conflicting docs |
| [01 — Layout and descriptor-relative runtime provisioning](phase-01-layout-and-descriptor-relative-runtime-provisioning.md) | DONE (2026-09-14; 100%) | 18h | Canonical config/audit are safely provisioned or migrated under API state; mismatch and cleanup behavior proven by fake syscalls |
| [02 — Systemd units and unit policy](phase-02-systemd-unit-template-checked-in-unit-and-policy.md) | DONE (2026-09-14; 100%) | 6h | Template, checked-in unit, rendered policy, and staging agree on one canonical `ExecStart` |
| [03 — Preflight, scripts, and smoke tests](phase-03-preflight-installer-reset-and-smoke-tests.md) | pending | 14h | SQLite discovery protects both migration candidates; installer/reset behavior and real deployment journeys prove the cutover |

**Next step:** Begin Phase 03 — Preflight, scripts, and smoke tests. Update preflight SQLite discovery to protect both migration candidates, update installer/reset scripts, and execute deployment smoke journeys.
## Preflight contract

- Server/Both only: safely inspect canonical and any extant legacy TOML; malformed, oversized, unreadable, linked, or non-regular candidates fail before service stop/switch.
- Union each valid file's effective session DB; expand `~` and relative paths as the API does under fixed HOME/working directory `/var/lib/dam-hopper`; preserve absolute paths; stable-deduplicate.
- When neither file exists, inspect the canonical default DB. During migration also retain the explicit legacy DB fallback. Check DB, `-wal`, and `-shm` holders for every candidate.
- Preflight is read-only. Absence permits Phase 01 seed; unsafe presence never becomes absence.

## Side-effect review checklist

- [x] Provisioning mutates only call-created fixed state objects; never repairs/replaces a pre-existing canonical, legacy, or audit object.
- [x] Failed create cleans only the recorded temporary/inode before publication; races and replacements are retained and reported.
- [ ] Web-only install creates no API state; installer performs no TOML seed/chmod/chown/copy.
- [x] `PUT /api/config` and reset writes retain API UID:GID `0600` and same-directory atomic replacement capability without sudo.
- [x] Unit hardening, one privileged prestart, restart behavior, explicit rootless config, host metadata, helper state, and legacy format-2 evidence stay unchanged.
- [ ] Docs and diagnostics name the new config/audit authorities only after runtime smoke passes.

## Cross-phase acceptance

- Fresh, legacy-only, both-present, rerun, every metadata/type mismatch, write/sync/rename failure, race, relative-root refusal, and SQLite DB/WAL/SHM cases have focused observable proof.
- `/var/lib/dam-hopper/dam-hopper.toml` and adjacent audit are API UID:GID `0600`; parents are API UID:GID `0700`; canonical bytes/inode are preserved on valid rerun.
- API cannot start after provisioning/preflight refusal. Canonical production `ExecStart` contains no `/etc/dam-hopper/dam-hopper.toml`; clean install leaves no active API-owned file under `/etc/dam-hopper`.

## Unresolved questions

None.
