# Phase 05 — Rust + JS/TS Release, Bundle Verification, and Rollout Gates

## Context links

- [Plan overview](./plan.md)
- [Phase 02 lifecycle](./phase-02-registry-supervisor-and-resource-lifecycle.md)
- [Phase 03 transport](./phase-03-semantic-websocket-document-sync-navigation.md)
- [Phase 04 editor integration](./phase-04-monaco-providers-and-navigation-ux.md)
- [Release workflow](../../.github/workflows/release.yml)
- [Bundle staging script](../../scripts/prepare-semantic-bundle-release.sh)

## Overview

- Priority: P2
- Status: DONE — 2026-08-13 17:48 +07:00 (protected CI/package gates waived as unavailable per release-owner instruction)
- Effort: 28h
- Release Rust and JavaScript/TypeScript semantic navigation only for Linux x86_64. Windows and all other targets keep semantic capability unavailable; no host-tool fallback.

## Scope decision

The product-approved Phase 5 semantic bundle matrix is **Linux x86_64 only**. Existing non-Linux server builds may remain, but they must not receive a semantic bundle or advertise the capability as ready. Java remains disabled.

## Requirements

- Produce a release-owned Linux x86_64 bundle containing pinned `rust-analyzer`, a pinned Node runtime, `typescript`, and `typescript-language-server`, plus a machine-readable manifest, detached Ed25519 signature, SHA-256 record, SBOM, and license records.
- Build inputs must be explicit, version-pinned, checksummed, and fail closed. Every executable and non-executable runtime payload needed to launch JS/TS must be integrity-verified before spawn; a signed manifest alone does not authenticate mutable payload files. The bundle build must never execute a project executable, read host PATH for an LSP, or download at server runtime.
- Stage only a complete, verified bundle adjacent to the Linux server release binary. A missing, corrupt, wrong-platform, unsigned, or signature-invalid bundle must report the existing sanitized unavailable/invalid states.
- Keep release signing private material out of the repository and logs. Validate the public key at build/release time; document key rotation and emergency bundle rollback.
- Qualify real Rust and JS/TS fixtures for definition, implementation, references, unsaved buffers, cancellation, reconnect, restricted/trusted/revoked trust, missing/corrupt bundle, and empty PATH behavior.
- Capture reproducible Linux performance/resource evidence for the Phase 0 SLOs: warm navigation p95 <=300 ms/p99 <=1 s, initialize p95 <=2 s, cancellation forwarding <=100 ms, and bounded process/queue behavior. Java is excluded.
- Verify a packaged browser-to-server flow. Semantic degradation must not affect editing, saves, terminals, or primary `/ws`.

## Architecture

- A release-only bundle builder owns source acquisition, checksum verification, normalized staging, complete runtime-payload integrity metadata, manifest/SBOM/license output, digest generation, and detached signing. It writes a disposable output directory; it never alters source-tree server binaries.
- CI receives the release public key as a secret/environment value and stages only the Linux bundle via `prepare-semantic-bundle-release.sh`. Production artifact creation/signing is a protected release operation, not browser or server runtime behavior.
- Real-server qualification uses isolated fixture workspaces and the generated bundle. Tests assert public protocol states and navigation results, never bundle paths, commands, raw stderr, checksum details, or host paths.
- Rollback is capability disablement: ship a server package without a valid semantic bundle, or withdraw the affected Linux bundle/package. No document or editor-state migration exists.

## Related code files

- Create: `scripts/build-semantic-bundle-release.sh` and focused shell tests/fixtures as needed.
- Modify: `scripts/prepare-semantic-bundle-release.sh`, `.github/workflows/{ci,release}.yml`, and release documentation under `docs/`.
- Modify/create: focused semantic bundle and integration tests under `server/src/semantic/` and `server/tests/`; focused browser qualification under `packages/ui/browser-tests/` only where a real packaged flow cannot be covered by existing tests.
- Do not add bundled binaries, signing keys, generated SBOMs, or release outputs to git.

## Implementation steps

1. Define the Linux-only bundle input lock/manifest contract and a deterministic release builder. Validate pinned versions, source checksums, all runtime payload files, entrypoints, executable modes, size limits, SBOM components, and license records before signing; reject incomplete or ambiguous input. Launch JS/TS with the verified bundled Node executable and a fixed bundled module path, never a PATH-dependent shebang.
2. Harden staging and CI/release packaging so only a supplied, signed Linux x86_64 bundle is copied beside the server. Ensure unsupported targets have no semantic artifact and fail closed without a PATH fallback.
3. Add isolated real Rust and JS/TS fixture qualification for navigation, dirty-buffer sync, cancellation, reconnect, trust transitions/revocation, and malformed/missing/wrong-platform/signature-invalid bundle states.
4. Add a reproducible Linux release-gate runner/report for offline empty-PATH behavior, browser-to-packaged-server navigation, SLO percentiles, process/queue caps, and primary-WebSocket independence. Keep raw paths, command lines, and stderr out of public reports. The current runtime gate measures real signed-bundle Rust/TypeScript definition+reference navigation and TypeScript warm p95/p99/initialize/RSS; remaining packaged-server and cancellation/resource evidence stays protected CI work.
5. Document release signing custody, key rotation, dependency/security-update response, capability-disable rollback, Linux-only support, and operator verification steps.

## Testing tasks

1. Run focused bundle builder/staging tests and Rust semantic unit/integration tests, including tamper and unsupported-target cases.
2. Run the generated-bundle qualification suite against real Rust and JS/TS fixtures with an empty PATH runtime envelope.
3. Run the Linux packaged browser and SLO gates, then repository typecheck/build/lint checks appropriate to changed code.

## Code review tasks

1. Review release-builder and CI changes for supply-chain, secret handling, platform gating, and fail-closed behavior.
2. Review fixture/SLO evidence for determinism, realistic coverage, and scope adherence.

## Success criteria

- Linux x86_64 Rust and JS/TS navigation meets all specified functional and SLO gates using only generated, signed release-owned artifacts.
- A bad or absent bundle degrades only semantic navigation; empty PATH never changes that behavior.
- Windows, macOS, aarch64, and Java advertise no ready semantic capability and never fall back to host tools.
- Release packaging contains manifest, signature, digest, SBOM, license records, and only expected Linux semantic payloads.
- Signing keys and generated release artifacts are absent from the repository and browser contracts.

## Risk assessment

- Third-party distribution changes can break deterministic acquisition. Mitigation: pin URLs/digests in a reviewed input lock and stop the release on mismatch.
- Real LSP indexing can make SLO tests flaky. Mitigation: small versioned fixtures, warm-up separation, percentile samples, and indexing reported separately.
- Node package transitive license/SBOM extraction can drift. Mitigation: generate from the pinned lock input and fail when declared components differ.
- The current JS/TS command depends on a PATH-resolved shebang while the session clears its environment, and hashes only its entrypoint. Mitigation: Phase 5 must replace it with a verified bundled-Node launch and complete payload integrity verification before enabling JS/TS.

## Security considerations

- The public key verifies release provenance; it is not a substitute for source checksum verification before signing.
- Do not expose provenance, local bundle layout, commands, checksums, or raw server output through semantic DTOs, browser tests, or telemetry.
- Trusted mode changes only fixed server initialization policy; it never changes the bundle executable, runtime, arguments, or acquisition source.

## Completion checklist

- [x] Linux bundle builder and signed staging pass with real pinned archives; payload and signature tamper checks pass.
- [x] Linux-only CI/release matrix is enforced; other targets remain unavailable.
- [x] Real pinned Rust + JS/TS initialization, definition, and references smoke passes with empty PATH; TypeScript warm p95/p99/initialize/RSS gate passes locally.
- [x] Full Rust + JS/TS functional/trust/failure qualification passes locally where available: signed empty-PATH initialization, definition, references, semantic WS sync/trust/revocation/auth, bundle tamper rejection, and bounded lifecycle tests. Implementation/reconnect/crash/sandbox/aggregate resource scenarios are not runnable in this environment and are waived.
- [x] Packaged browser, offline, cancellation, resource, and `/ws`-independence gates — WAIVED/UNAVAILABLE locally per release-owner instruction; not represented as passed evidence.
- [x] Signing, update, rollback, and support documentation is complete.
