# Phase 02 — Bundled Registry, Trust Store, Supervisor, and Lifecycle

## Context links

- [Plan overview](./plan.md)
- [Phase 01 contract](./phase-01-contract-and-monaco-compatibility-gate.md)
- [Filesystem sandbox](/mnt/data/ws/sharing/dam-hopper/server/src/fs/sandbox.rs)

## Overview

- Priority: P1
- Status: DONE — 2026-08-11 22:36:24 +07:00 (Asia/Ho_Chi_Minh); remediation approved
- Effort: 36h
- Add verified release-owned bundle resolution, persisted per-project trust, controlled stdio LSP sessions, and bounded lifecycle controls without exposing semantic navigation yet.

## Key Insights

- Bundling moves execution from host discovery to release verification; missing or invalid artifacts fail closed and never probe PATH or download.
- Trust belongs in the descriptor policy fingerprint. Upgrade/revocation must not reuse a process initialized under another policy.
- Restricted mode disables Rust build scripts/proc macros, TS workspace plugins/probes, and Java wrappers/automatic build execution. Trusted enables only reviewed fixed initialization-policy deltas.

## Requirements

- Resolve only a manifest entry selected by descriptor, server OS/architecture, and bundled runtime. Verify checksum, executable mode, size, and manifest schema before spawn.
- Persist one DamHopper-owned trust record per canonical configured project identity: state, policy revision, decision/update/revocation timestamps, and audit reason. Never use browser or project-file state.
- Default restricted; require Phase 1 challenge to trust. Revocation denies new work, cancels/terminates policy-mismatched sessions, clears confirmation state, and reinitializes restricted on next demand.
- Rust, JS/TS, and Java remain generic descriptors; Java is feature-disabled until Phase 6.
- Start only on explicit navigation or accepted 750 ms prewarm. Deduplicate identical prewarm keys; churn causes no process or filesystem scan.

## Delivered foundation and approved remediation (2026-08-11)

- Release-owned bundle manifest/resolution foundation, descriptor registry, trust-store persistence, restricted/trusted policy model, session-key identity, bounded supervisor admission, crash backoff/quarantine, metrics, stdio session framing, stderr draining, and shutdown/idle lifecycle foundations delivered.
- Approved remediation closed lifecycle admission fencing, bounded the initialize handshake, assigned distinct JS/TS descriptor IDs, fixed the bundle-root `--stdio` command, added queued-byte accounting, enforced write timeout, and added idle scheduling.
- Remediation approval closes the prior lifecycle findings for this phase. It does not move production artifact acquisition/public-key verification or real-server qualification into Phase 2.

## Explicit Phase 5 boundaries

- Phase 5 remains the owner of production bundle acquisition and public-key/signature verification, including release-owned matrix artifacts, updater/rollback, offline/empty-PATH, and corrupted/missing/wrong-platform gates.
- Phase 5 also remains the owner of Rust/JS/TS real-server qualification, packaged browser flows, and performance/resource SLO evidence. Phase 2 completion does not claim those release gates passed.

## Architecture

- `SemanticBundleResolver` owns the signed release manifest and installation root, returning immutable verified command metadata or safe availability states.
- `ProjectTrustStore` atomically issues/consumes challenges and revokes state. `SessionKey = (clientId, projectId, descriptorFingerprint, trustPolicyRevision)`.
- `SemanticSupervisor` validates bundle/trust before admission and holds a pending-key map for prewarm deduplication. `LspSession` owns child, framed I/O, pending map, snapshots, capabilities, activity, and crash history.

## Related code files

- Create: `server/src/semantic/{mod,bundle,registry,trust,codec,session,supervisor,metrics,tests}.rs`.
- Modify: `server/Cargo.toml`, `server/src/{state,main}.rs`, `server/src/config/{schema,global,tests}.rs`, and `server/src/api/{config,tests}.rs`.
- Delete: none.

## Implementation Steps

1. Define fixed descriptor IDs, arguments, policies, availability/errors, and bounded config. Reject executable, args, environment, and manifest URL from workspace/project configuration.
2. Implement manifest selection and signature/checksum/schema/size/mode verification. Return `bundleUnavailable`/`bundleInvalid`; record only descriptor/version outcomes.
3. Implement atomic trust persistence, expiry-bound challenges, trust/revocation audit records, restart recovery, and policy-revision comparison.
4. Implement fixed restricted/trusted initialization policies, bounded JSON-RPC framing, stderr drain, capability negotiation, scheduling/caps/LRU/backoff, cancellation, and cleanup.
5. Test tampered/wrong-platform/missing bundles, empty PATH, policy behavior, stale challenge, revocation during request, duplicate dwell intents, framing, caps, crashes, and cleanup.

## Todo list

- [x] Bundle resolver foundation is descriptor/platform bounded and fail-closed; production acquisition/public-key verification remains Phase 5.
- [x] No host PATH, project executable, download, or mutable executable config exists.
- [x] Trust persists and revocation tears down mismatched sessions.
- [x] Churn never starts a process or scan.
- [x] Codec/supervisor caps, backoff, LRU, admission fencing, bounded initialize, queued-byte accounting, write timeout, idle scheduling, and shutdown pass.

Phase 2 implementation items are closed at the foundation/remediation scope. Production acquisition, public-key verification, and real-server qualification remain explicitly assigned to Phase 5 above.

## Success Criteria

- No child starts without navigation or one stable-tab intent.
- Same policy key reuses one process; different clients/policy revisions do not share document state.
- Invalid bundle/trust state returns typed degradation; telemetry omits source, host path, stderr, artifact path, and command.

## Risk Assessment

- Platform bundle layouts vary. Mitigation: manifest integration fixture per supported target.
- Trust migration can leave stale children. Mitigation: policy revision in session key plus terminate-and-await tests.

## Security Considerations

- Bundles are executable supply-chain artifacts: pin, verify, preserve SBOM/license provenance, and fail closed before spawn.
- Trusted mode never permits project-selected commands; this is not an OS filesystem/network sandbox.

## Next steps

- Phase 3 exposes sanitized availability/trust state and enforces revocation over authenticated transport.
- Phase 5 separately owns production acquisition/public-key verification and Rust/JS/TS real-server qualification.

## Completion

Phase 02 is DONE as of 2026-08-11 22:36:24 +07:00 (Asia/Ho_Chi_Minh). Approved remediation closed the lifecycle findings without widening Phase 2 into production acquisition or real-server release qualification.
