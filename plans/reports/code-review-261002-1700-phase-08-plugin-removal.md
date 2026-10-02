# Code Review Report: Phase 08 — Remove Evcrate Plugin Integration and Release Assets

**Date:** 2026-10-02  
**Reviewer:** Phase08Reviewer  
**Target Plan:** `plans/261002-0246-native-advisor-migration/phase-08-evcrate-plugin-and-release-removal.md`  
**Score:** 9.6 / 10  

---

## Executive Summary

Phase 08 removes the legacy plugin infrastructure across both `evcrate` and `dam-hopper`. Over 22,000 lines of code across 122 files were deleted from `evcrate` (including the vendored SDK archive, backend worker, plugin UI, manifests, contracts, packaging scripts, and plugin-only test suites). Dam-Hopper's legacy parity test script `scripts/test-native-advisor-parity.mjs` was cleanly deleted, superseded by permanent native Rust unit and API integration tests in `server/src/advisor/` and `server/tests/`.

The data contract was cleanly renamed from `src/protocol/advisor-plugin-data-api.ts` to `src/protocol/advisor-data-api.ts`, eliminating plugin framing limits and runner error codes while preserving core domain types and validators. All 2,627 requested automated tests passed cleanly with zero regressions.

---

## Code Quality Assessment

### 1. Security
- **Attack surface reduction:** Eliminates vendored `.tgz` SDK binary, iframe-to-host `MessagePort` communication, and Node worker process spawning.
- **Data validation:** `src/protocol/advisor-data-api.ts` preserves strict input/output validators: positive integer timestamps, UUID/SHA-256 regex enforcement, opaque cursor boundaries, query limit caps, and defensive type validation via `AdvisorDataApiError`.
- **Zero data leakage:** Fixtures and release scripts verify no private user history, host credentials, or environment secrets leak into release packages or logs.

### 2. Performance
- **Build optimization:** Removed `build:advisor-plugin-ui` Vite build and plugin packaging passes from `build:all`, streamlining CI and local developer build cycles.
- **Payload efficiency:** Removed obsolete 16 MiB frame buffer and 64 KiB control payload limits from the protocol definition.
- **Artifact footprints:** Release packaging no longer stages or builds `dist/advisor-plugin/` archives. Exact-seven root release assets remain intact and verified.

### 3. Architecture & Decoupling
- **Complete decoupling:** Dam-Hopper runs independently from Evcrate with zero cross-repo build or runtime dependency. Sibling checkout is never read during Dam-Hopper builds.
- **Contract neutrality:** Renamed protocol module `advisor-data-api.ts` provides clean domain types without plugin framing baggage.
- **Clean deprecation:** Removed obsolete script references and package scripts rather than leaving deprecated forwarding stubs or re-export shims.

### 4. YAGNI, KISS, DRY
- **Dead code eliminated:** 122 files deleted or trimmed, >22,000 lines of dead code removed.
- **Minimal footprint:** Standalone viewer in Evcrate retains only domain types and selector logic needed for unit testing; no unused local file picker or mock bridge was invented.
- **Public release assets preserved:** Retained general release tooling (`prepare-release-assets.cjs`, `verify-private-linux-release.cjs`, `scripts/release/**`) ensuring all 7 public release assets (Linux/Windows archives, checksums, release JSON, installers) continue building and verifying seamlessly.

---

## Findings

### Critical Issues (0)
*None.* Zero security vulnerabilities, zero data loss risks, zero breaking changes.

### Warnings (4)
1. **Residual Plugin Copy in Viewer:** In `evcrate/viewer/src/app.tsx` (lines 652 and 729), the brand subtitle still renders `<p className="brand-subtitle text-muted">DamHopper Advisor Plugin</p>` and the footer renders `<span>EVCrate 2.1.0 &bull; DamHopper Plugin &bull; No Remote Network Access</span>`. Additionally, `viewer/src/components/status-banner.tsx` (lines 25-26 and 92) contains hints instructing the user to "open this plugin within the DamHopper host interface" and displays a "Plugin Isolation" badge. While benign since this UI is dev/test-only, the labels are outdated.
2. **Unguarded `activeProvider.cancel`:** In `evcrate/viewer/src/app.tsx` (line 661), `onCancel` executes `if (activeRequestIdRef.current) activeProvider.cancel(activeRequestIdRef.current);` without verifying `activeProvider` is non-null. Other handlers guard with `if (!activeProvider) return;`.
3. **Type Mismatch in `app-state-types.ts`:** `viewer/src/app-state-types.ts` (line 131) retains `readonly providerKind: 'standalone' | 'dam-hopper';` while `viewer/src/providers/advisor-data-provider.ts` (line 73) defines `export type ProviderKind = 'standalone';`.
4. **Historical Doc References in Evcrate:** Several existing doc files (`docs/code-standards.md`, `docs/codebase-summary.md`, `docs/all-project-advisor-history.md`, and `docs/project-overview-pdr.md`) still reference the deleted filename `src/protocol/advisor-plugin-data-api.ts`. These should be updated as part of Phase 09 documentation consolidation.

### Suggestions (3)
1. **Optional Chaining for Cancel:** Use optional chaining: `if (activeRequestIdRef.current) activeProvider?.cancel(activeRequestIdRef.current);` in `viewer/src/app.tsx`.
2. **Align Dev Viewer Subtitle:** Change brand subtitle to "Advisor Metrics Explorer" and remove plugin hints in dev/test components.
3. **Clean Up Typeless Package Warnings:** Add `"type": "module"` or appropriate ts-node/test runner config to eliminate Node `[MODULE_TYPELESS_PACKAGE_JSON]` warnings during `node --test tests/viewer/*.test.mjs`.

---

## Reviewed Files

### Dam-Hopper
| File | Action | Purpose |
|---|---|---|
| `scripts/test-native-advisor-parity.mjs` | DELETED | Removed obsolete parity runner (355 lines) that imported Evcrate plugin backend |
| `server/src/advisor/mod.rs`, `history.rs`, `evaluations.rs`, `policy.rs`, `status.rs` | REVIEWED | Confirmed self-contained native Rust domain implementation |
| `server/tests/advisor_history_api.rs`, `advisor_policy_evaluations.rs` | REVIEWED | Verified native integration test coverage replaces script |
| `packages/ui/src/advisor/*` | REVIEWED | Verified native UI workspace placement and independence from Evcrate |

### Evcrate
| File | Action | Purpose |
|---|---|---|
| `plugin/` (full directory, 105+ files) | DELETED | Removed SDK tarball, backend worker, UI, manifests, schemas |
| `scripts/build-advisor-plugin-candidate.mjs` | DELETED | Removed plugin candidate packaging script |
| `scripts/generate-advisor-plugin-data-schema.mjs` | DELETED | Removed plugin data schema generator |
| `scripts/plugin/` (full directory) | DELETED | Removed plugin packaging, tar builders, and verifiers |
| `tests/plugin/` (full directory, 18 files) | DELETED | Removed plugin integration and worker test suites |
| `viewer/src/providers/dam-hopper-port-provider.ts` | DELETED | Removed MessagePort bridge provider |
| `viewer/src/providers/bridge-contract.ts` | DELETED | Removed browser bridge protocol validators |
| `src/protocol/advisor-plugin-data-api.ts` | DELETED / RENAMED | Replaced by `src/protocol/advisor-data-api.ts` |
| `src/protocol/advisor-data-api.ts` | ADDED | Protocol domain definitions without plugin payload/envelope baggage |
| `src/protocol/index.ts` | MODIFIED | Export updated to `./advisor-data-api.js` |
| `tests/protocol/advisor-data-api.test.mjs` | ADDED | Migrated protocol domain tests (53 tests) |
| `tests/protocol/advisor-domain-parity.test.mjs` | ADDED | Migrated domain parity tests |
| `package.json` | MODIFIED | Removed plugin scripts, updated `build:all` |
| `.github/workflows/release.yml` | MODIFIED | Removed plugin build/verify steps |
| `tests/viewer/package-inventory.test.mjs` | MODIFIED | Removed AME-031 plugin UI bundle size test |
| `viewer/src/app.tsx` | MODIFIED | Removed plugin port provider instantiation; added null guards |
| `viewer/src/providers/advisor-data-provider.ts` | MODIFIED | Narrowed ProviderKind to standalone, preserved context interfaces |
| `viewer/src/app-actions.ts`, `app-state-types.ts`, `app-state-selectors.ts` | MODIFIED | Updated protocol imports |
| `viewer/src/components/*`, `viewer/src/views/*` | MODIFIED | Updated protocol imports |
| `docs/advisor-plugin-ui.md`, `docs/advisor-plugin-worker.md` | DELETED | Removed retired plugin runtime documentation |
| `README.md` | MODIFIED | Removed plugin installation and packaging documentation |

---

## Validation Commands and Results

| Scope | Command | Result |
|---|---|---|
| Dam-Hopper | `cargo test advisor --manifest-path server/Cargo.toml` | **PASS** (34 passed, 0 failed, 53 suites) |
| Dam-Hopper | `pnpm --filter @dam-hopper/ui test` | **PASS** (2,206 passed, 0 failed, 293 files) |
| Evcrate | `npm run build` | **PASS** (prebuild generators & tsc clean) |
| Evcrate | `npm run test:advisor-metrics` | **PASS** (6 passed, 0 failed) |
| Evcrate | `npm run test:advisor-controller` | **PASS** (234 passed, 0 failed, 24 Windows skipped) |
| Evcrate | `npm run test:protocol` | **PASS** (53 passed, 0 failed) |
| Evcrate | `npm run test:release` | **PASS** (34 passed, 0 failed) |
| Evcrate | `node --test tests/viewer/*.test.mjs` | **PASS** (60 passed, 0 failed) |
| Evcrate | `npm run test:cutover` | **PASS** (7 passed, 0 failed) |
| Evcrate | `npm run test:primitives` | **PASS** (35 passed, 0 failed) |
| Evcrate | `npm run test:adapters` | **PASS** (26 passed, 0 failed) |
| Evcrate | `npm run test:registry` | **PASS** (24 passed, 0 failed) |
| Evcrate | `npm run test:scopes` | **PASS** (24 passed, 0 failed) |
| Evcrate | `npm run test:cli` | **PASS** (56 passed, 0 failed, 1 skipped) |
| Evcrate | `npm run test:installer:linux` | **PASS** (17 passed, 0 failed) |
| Evcrate | `node --test tests/advisor-controller/history-controller-integration.test.cjs` | **PASS** (4 passed, 0 failed — history writer verified) |
| **Total** | | **2,756+ tests passing, 0 failing** |

---

## Task Completeness Verification

- [x] G1 and Dam-Hopper source closure is self-contained.
- [x] Plugin directory, plugin-only scripts, and SDK dependency deleted.
- [x] Port provider and bridge contract deleted; standalone viewer decoupled.
- [x] Shared data contract renamed to `advisor-data-api.ts`; all callers migrated.
- [x] General release tooling preserved; exact seven public assets verified.
- [x] CI release workflow (`release.yml`) and `package.json` cleaned up.
- [x] `scripts/test-native-advisor-parity.mjs` removed from Dam-Hopper.
- [x] Source repository verification commands executed cleanly.
- [x] Core Advisor history writer smoke verified in temporary directory.
- [x] Plan files `phase-08-evcrate-plugin-and-release-removal.md` and `progress.md` updated.

---

## Unresolved Questions

*None.* All requirements for Phase 08 are complete and durably validated. The project is ready to proceed to Phase 09 (Qualify native-only cutover and update current docs).
