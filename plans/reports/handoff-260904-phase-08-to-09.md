# Phase 08 to Phase 09 Handoff: Behavioral, Security, and Failure Validation Complete

**Date:** 2026-09-04  
**Source Phase:** Phase 08 (Behavioral, Security, and Failure-Injection Validation)  
**Target Phase:** Phase 09 (Documentation, Roadmap, Changelog, and Release Cutover)  
**Status:** Ready for Documentation Cutover  

---

## 1. Executive Summary

Phase 08 has completed all implementation, testing, and review gates for the Linux Release Installer Architecture. The release pipeline, manager CLI, multi-role services, durable activation journal, crash recovery, and format-2 migration have been verified end-to-end on Fedora 44 x86_64 / systemd 259.

Terminal validation through the `tester` agent passed 8/8 commands with zero failures. Holistic code review through `reviewer` evaluated the full implementation, identified 3 hardening points (setup-node SHA pin, packaged asset testing, legacy health preflight validation), and confirmed all remediations before issuing terminal approval.

---

## 2. Verified Contracts & Evidence

| Contract Area | Specification | Verification Evidence |
|---|---|---|
| **Deterministic Backend** | Rust 1.97.1+ / Cargo with vendored features | 1,018 tests passed across 31 suites in 16.44s (`cargo test`) |
| **Frontend Contracts** | Runtime config validation and server profile precedence | 1,447 tests passed across 214 files in 13.09s (targeted: 45/45 passed in 1.09s) |
| **Web & UI Builds** | TypeScript strict compilation + Vite bundling | Clean build: 6,019 web modules, 7 extension modules |
| **Script Integrity** | Strict POSIX/Bash syntax | 11 shell scripts verified with `bash -n` |
| **Release Versioning** | SemVer `vX.Y.Z` alignment across all manifests | `pnpm release:verify` passed for v0.1.0 |
| **Reproducible Packaging** | Deterministic tarball byte equality across independent runs | `pnpm release:package-twice` matched SHA-256 `edbfe8bbec069ad4065650cf99407b18d6689a3ccc6f01b47681737b72afaa0c` (22,278,394 bytes, 156 manifest entries, 153 SBOM files) |
| **Rootless Smoke** | Real unprivileged process execution on dynamic ports | `pnpm release:rootless-smoke` tested `dam-hopper-web` and `dam-hopper-server`, HTTP headers, health routes, and clean SIGTERM exit |
| **Deployment Journeys** | 6 modular deployment verification scripts | `pnpm test:deploy` passed all journeys (clean install 3 roles, upgrade/rollback, crash recovery at 3 boundaries, security isolation, web contract, format-2 rehearsal) |
| **Runtime Evidence Gate** | Schema v1 with commit binding and zero secret leaks | `node tests/deploy/linux-release-evidence-check.mjs` passed |

---

## 3. Authoritative Architectural Contracts for Phase 09 Docs

1. **Role Execution Models:**
   - **API Server:** Runs as `User=root` / `Group=root` per owner-directed MVP decision. This is documented as an explicit critical risk in system architecture documentation.
   - **Web Server:** Dedicated static host `dam-hopper-web` running unprivileged as `User=dam-hopper-web` / `Group=dam-hopper-web` with `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, and `NoNewPrivileges=true`.
2. **Standard Ports & Endpoints:**
   - API Server: Direct port `4801`; health check at `GET /api/health`.
   - Web Host: Direct port `4802`; health check at `GET /__dam-hopper/health`; runtime config at `GET /__dam-hopper/runtime-config.json`.
   - Legacy format-2 port `4800` is strictly forbidden and rejected during preflight.
3. **CLI Grammar & User Experience:**
   - Bootstrap: `curl -fsSL ... | bash -s -- --role <server|web|both> [--version <vX.Y.Z> | --latest]`
   - The installer extracts only the manager binary, downloads/verifies assets, stages the release to `PENDING`, and **never** automatically activates services.
   - Activation: `sudo dam-hopper start` executes the state machine (`PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`), requiring a 20s startup deadline + 10s health stability (20 consecutive probes).
   - Rollback: `sudo dam-hopper rollback` restores previous release or baseline.
   - Recovery: `sudo dam-hopper recover` reconciles interrupted transactions on boot or after crashes.
   - Status: `dam-hopper status [--json]` displays authoritative state.
4. **Breaking Changes from Format-2 Retirement:**
   - Deleted: `deploy/run-linux-production.sh` and `deploy/reset-linux-production.sh`.
   - Deleted: `deploy/systemd/dam-hopper.service` and `tests/deploy/linux-production-fixtures.sh`.
   - Deleted: npm scripts `linux:production` and `linux:reset`.
   - Format-2 Migration: Existing healthy format-2 installations are imported atomically via `renameat2(RENAME_EXCHANGE)` when running `dam-hopper install`. Any drift, nonces, or format-1 state fails closed.

---

## 4. Phase 09 Target Documentation Checklist

- [ ] `README.md`: Update Linux deployment quickstart to use `dam-hopper-install.sh` and `dam-hopper start`.
- [ ] `docs/linux-systemd.md`: Rewrite as the authoritative Fedora 44 release guide (< 800 lines); eliminate all obsolete format-1/runner script references.
- [ ] `docs/system-architecture.md`: Document publisher, manifest schema, role projections, and durable transaction invariants.
- [ ] `docs/configuration-guide.md` & `docs/user-guide-multi-server-profiles.md`: Document runtime config, API origin validation, and profile precedence.
- [ ] `docs/api-reference.md`: Document API/web health schemas and API-only default.
- [ ] `docs/code-standards.md` & `docs/codebase-summary.md`: Document release manager structure, testing tools, and contributor workflows.
- [ ] `docs/project-roadmap.md` & `docs/CHANGELOG.md`: Confirm Phase 08 recorded and record Phase 09 completion.
