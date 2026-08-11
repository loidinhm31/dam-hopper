# Phase 02 — Bundled Registry, Trust Store, Supervisor, and Lifecycle

## Context links

- [Plan overview](./plan.md)
- [Phase 01 contract](./phase-01-contract-and-monaco-compatibility-gate.md)
- [Filesystem sandbox](/mnt/data/ws/sharing/dam-hopper/server/src/fs/sandbox.rs)

## Overview

- Priority: P1
- Status: completed with issues — approved 2026-08-11 17:32:46 +07:00 after three review cycles
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

## Delivered foundation (2026-08-11)

- Release-owned bundle manifest/resolution foundation, descriptor registry, trust-store persistence, restricted/trusted policy model, session-key identity, bounded supervisor admission, crash backoff/quarantine, metrics, stdio session framing, stderr draining, and shutdown/idle lifecycle foundations delivered.
- Final review approved with issues after three review cycles. Approval covers the delivered foundations only; it does not close the lifecycle follow-ups below.

## Approved-with-issues follow-ups

- Fix crash-before-registration slot leak.
- Close stale request/admission race during revocation or shutdown.
- Supply and validate the actual bundle acquisition input; current foundation does not claim complete acquisition behavior.
- Resolve JS/TS descriptor identity problem.
- Enforce the queued aggregate memory cap.
- Complete the LSP handshake.

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

- [ ] Bundle resolver accepts only verified release artifacts.
- [ ] No host PATH, project executable, download, or mutable executable config exists.
- [ ] Trust persists and revocation tears down mismatched sessions.
- [ ] Churn never starts a process or scan.
- [ ] Codec/supervisor caps, backoff, LRU, and shutdown pass.

The unchecked items above remain release follow-ups. In particular, the approved review does not claim the six lifecycle issues listed in **Approved-with-issues follow-ups** are fixed.

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
