# Stable Release Text Documentation Report

## Executive Summary

- **Assignment Scope:** Owned exclusively 11 documentation files:
  - `docs/configuration-guide.md`
  - `docs/configuration/server-deployment.md`
  - `docs/configuration/server-runtime-settings.md`
  - `docs/codebase-summary-release.md`
  - `docs/linux-nohup.md`
  - `docs/linux-release-manager.md`
  - `docs/linux-release-manifest.md`
  - `docs/linux-release-publisher-bootstrap.md`
  - `docs/linux-release-runtime-provisioning.md`
  - `docs/linux-systemd.md`
  - `docs/windows-release-packaging.md`
- **Goal:** Completely eliminated all development 'phase' and 'plan' whole words, replaced timeline execution narratives with stable subsystem and operational descriptions, removed all planning dependencies (`plans/`), migrated broken heading links, and ensured all documents remain strictly under 800 physical LOC.

## Key Changes and Subsystem Refactoring

1. **Elimination of Phase and Plan Terminology:**
   - Rewrote all development milestone labels (`Phase 01`, `Phase 02`, `Phase 03`, `Phase 04`, `Phase 05`, `Phase 06`, `Phase 07`, `Phase 09`) into clear subsystem, architecture, and verification descriptions across all 11 owned files.
   - Replaced narrative development progress and timeline statements with current system operational facts.
   - Retained factual historical dates (e.g. 2026-09-13, 2026-09-14, 2026-09-21) and verified qualification test counts (e.g. 84 passed, 0 failed, 0 ignored across integration suites; 3,504 passed / 9 skipped or ignored across the release ledger) without development phase tagging.

2. **Accurate Codebase Contracts and Link Migrations:**
   - `docs/configuration-guide.md`:
     - Rewrote line 685: removed the planning report link dependency (`../plans/reports/qualification-260930-1045-agent-status-linux-qualification.md`), documented exact per-agent notification readiness and policy (OMP requires matching install/runtime paths and managed extension; Codex is ineligible; Claude requires matching paths and ready native hooks; saves recheck eligibility), and referred directly to canonical `[Agent Status Architecture](./architecture/agent-status.md)`.
     - Replaced `Phase 04 note` labels with descriptive `Security note` and `Registry note` markers.
     - Neutralized timeline narratives for idle suspend and shutdown budgets into operational architecture contracts.
     - Documented Linux Chromium visual smoke boundaries without developmental phase markers.
   - `docs/configuration/server-deployment.md`:
     - Renamed heading `### Media compatibility and Phase 09 qualification` to `### Media compatibility and workbench qualification`.
     - Replaced `Phase 09 reconciled` with `Workbench integration qualification reconciled`.
     - Rephrased `Phase 06 closes documentation` with `Operational runbooks and documentation do not replace target release qualification`.
     - Rephrased `Phase 00 monitor profiler` to `baseline monitor profiler`.
   - `docs/configuration/server-runtime-settings.md`:
     - Replaced `This Phase 07 release` with `The current release`.
     - Replaced `The Phases 02–03 canonical idle-suspend event producer` with `The canonical idle-suspend event producer`.
     - Replaced `(Phases 06–07)` qualifier on `dam-hopper diagnose --json`.
   - `docs/codebase-summary-release.md`:
     - Replaced `preserving release architecture and phase boundaries` with `operational boundaries`.
     - Refactored section headings to remove `Phase 00`, `Phase 01–02`, `Phase 02`, and `Phase 03` labels while preserving historical qualification dates.
   - `docs/linux-nohup.md`:
     - Clarified backend and web separation under current release architecture without `Phase 03` marker.
     - Replaced `Phase 03 budget` with `qualification budget`.
     - Replaced `Phase 07 release check set` with `release check set`.
   - `docs/linux-release-manager.md`:
     - Removed phase numbers from event writer and preflight SQLite migration descriptions.
     - Replaced prose `transaction phase/backup paths` with `transaction stage/backup paths` on line 400.
     - Removed phase qualifiers from headings (`Bootstrap handoff`, `Dedicated web-role handoff`, `Format-2 migration`).
   - `docs/linux-release-manifest.md`:
     - Removed phase numbers from publisher and bootstrap boundary, archive identity, web runtime contract, and staging/activation lifecycle descriptions.
   - `docs/linux-release-publisher-bootstrap.md`:
     - Updated status line to `Cross-platform Release CI and guidance are verified (2026-09-21); Linux migration-gate qualification was approved on 2026-09-13`.
     - Removed phase qualifier from Windows direct-server profile heading.
     - Replaced `Phase 03 fixture` with `publisher test fixture` and `Phase 03 qualification` with `bounded qualification`.
   - `docs/linux-release-runtime-provisioning.md`:
     - Updated status line to `**Status:** Verified (2026-09-14)`.
     - Replaced `Phase 01 gate` with `runtime provisioning gate`.
   - `docs/linux-systemd.md`:
     - Removed phase qualifier from `Capturing a production diagnostics bundle` heading.
     - Repointed broken reference `[Linux Release Manager — Production diagnostics](./linux-release-manager.md#production-diagnostics-phase-06)` to stable anchor `./linux-release-manager.md#production-diagnostics`.
   - `docs/windows-release-packaging.md`:
     - Removed `(Phases 01–03)` from document title and `Status` preamble.
     - Removed phase qualifiers from `Release CI workflow` and `PowerShell bootstrap installer` headings.

## Exception Inventory

The following genuine occurrence of a `phase` substring is retained as a permitted exception:
1. **Actual Codebase File and Script Paths:**
   - `scripts/qualify-phase09-workbench.mjs` in `docs/configuration/server-deployment.md:151` (live qualification harness script present in repo checkout).

Residual Grep Verification:
- `\b(phase|phases)\b`: **0 matches**
- `\b(plan|plans)\b`: **0 matches**
- `plans/`: **0 matches**

## Heading Rename Map Sent to Main

```text
configuration-guide.md: ### Policy and agent-executable fields (Phase 01) -> ### Policy and agent-executable fields (#policy-and-agent-executable-fields)
configuration-guide.md: ### Release-manager helper service (Production CLI Phase 03) -> ### Release-manager helper service (#release-manager-helper-service)
configuration-guide.md: ### Execution-only indefinite sleep (Phase 01) -> ### Execution-only indefinite sleep (#execution-only-indefinite-sleep)
server-deployment.md: ### Media compatibility and Phase 09 qualification -> ### Media compatibility and workbench qualification (#media-compatibility-and-workbench-qualification)
codebase-summary-release.md: ### Phase 01–02 Windows direct-server release and installer -> ### Windows direct-server release and installer (#windows-direct-server-release-and-installer)
codebase-summary-release.md: ### Phase 03 cross-platform Release CI and guidance -> ### Cross-platform Release CI and guidance (#cross-platform-release-ci-and-guidance)
codebase-summary-release.md: ### Phase 00 merge boundary (2026-09-14) -> ### Historical merge reconciliation (2026-09-14) (#historical-merge-reconciliation-2026-09-14)
codebase-summary-release.md: ### Phase 01 runtime-state boundary (2026-09-14) -> ### API runtime-state boundary (2026-09-14) (#api-runtime-state-boundary-2026-09-14)
codebase-summary-release.md: ### Phase 02 systemd unit/policy boundary (2026-09-14) -> ### Systemd unit and policy boundary (2026-09-14) (#systemd-unit-and-policy-boundary-2026-09-14)
codebase-summary-release.md: ### Phase 03 preflight, installer, and reset boundary (2026-09-14) -> ### Preflight, installer, and reset boundary (2026-09-14) (#preflight-installer-and-reset-boundary-2026-09-14)
linux-release-manager.md: ### Phase 03 preflight SQLite migration protection -> ### Preflight SQLite migration protection (#preflight-sqlite-migration-protection)
linux-release-manager.md: ## Bootstrap handoff (Phase 06) -> ## Bootstrap handoff (#bootstrap-handoff)
linux-release-manager.md: ### Dedicated web-role handoff (Phase 03) -> ### Dedicated web-role handoff (#dedicated-web-role-handoff)
linux-release-manager.md: ## Format-2 migration (Phase 07) -> ## Format-2 migration (#format-2-migration)
linux-release-manifest.md: ## Publisher and bootstrap boundary (Phase 03 cross-platform release; Phase 06 Linux runtime) -> ## Publisher and bootstrap boundary (#publisher-and-bootstrap-boundary)
linux-release-manifest.md: ## Phase 03 web runtime contract -> ## Web runtime contract (#web-runtime-contract)
linux-release-publisher-bootstrap.md: ### Windows direct-server profile and bootstrap installer (Phases 01–03) -> ### Windows direct-server profile and bootstrap installer (#windows-direct-server-profile-and-bootstrap-installer)
linux-systemd.md: ### Capturing a production diagnostics bundle (Phase 07 complete) -> ### Capturing a production diagnostics bundle (#capturing-a-production-diagnostics-bundle)
windows-release-packaging.md: # Windows Release Asset Packaging and Bootstrap Installer (Phases 01–03) -> # Windows Release Asset Packaging and Bootstrap Installer (#windows-release-asset-packaging-and-bootstrap-installer)
windows-release-packaging.md: ### Release CI workflow (Phase 03) -> ### Release CI workflow (#release-ci-workflow)
windows-release-packaging.md: ## PowerShell bootstrap installer (Phase 02) -> ## PowerShell bootstrap installer (#powershell-bootstrap-installer)
```

## Physical Line Count Verification

| File | Physical LOC | Limit | Status |
| --- | ---: | ---: | --- |
| `docs/configuration-guide.md` | 731 | 800 | OK |
| `docs/configuration/server-deployment.md` | 202 | 800 | OK |
| `docs/configuration/server-runtime-settings.md` | 203 | 800 | OK |
| `docs/codebase-summary-release.md` | 112 | 800 | OK |
| `docs/linux-nohup.md` | 174 | 800 | OK |
| `docs/linux-release-manager.md` | 696 | 800 | OK |
| `docs/linux-release-manifest.md` | 337 | 800 | OK |
| `docs/linux-release-publisher-bootstrap.md` | 409 | 800 | OK |
| `docs/linux-release-runtime-provisioning.md` | 198 | 800 | OK |
| `docs/linux-systemd.md` | 564 | 800 | OK |
| `docs/windows-release-packaging.md` | 241 | 800 | OK |

All 11 files are strictly below the 800 LOC cap.

## Unresolved Questions

None. Operational boundaries and release gates are clearly documented and aligned with codebase reality.
