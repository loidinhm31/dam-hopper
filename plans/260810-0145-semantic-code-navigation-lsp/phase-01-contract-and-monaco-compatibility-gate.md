# Phase 01 — Contract, Trust, Bundle, and Monaco Compatibility Gate

## Context links

- [Plan overview](/mnt/data/ws/sharing/dam-hopper/plans/260810-0145-semantic-code-navigation-lsp/plan.md)
- [Approved architecture](/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md#semantic-code-navigation-planned)
- [Monaco/LSP research](/mnt/data/ws/sharing/dam-hopper/plans/260810-0145-semantic-code-navigation-lsp/research/researcher-01-vscode-lsp-integration.md)
- [Latency/lifecycle research](/mnt/data/ws/sharing/dam-hopper/plans/260810-0145-semantic-code-navigation-lsp/research/researcher-02-latency-language-lifecycle.md)
- [Code standards](/mnt/data/ws/sharing/dam-hopper/docs/code-standards.md)

## Overview

- Priority: P1 gate
- Status: DONE — 2026-08-11 14:01:37 +07:00 (Asia/Ho_Chi_Minh)
- Effort: 12h
- Prove Monaco 0.55.1 behavior and freeze browser-safe navigation, project-trust, bundle-availability, and 750 ms delayed-prewarm contracts before backend or UX implementation.

## Key Insights

- Provider registration is public and stable; unopened cross-file models and multi-location peek remain the standalone-Monaco boundary.
- Host PATH and user-installed tool discovery contradict the validated release decision; browser-visible availability must describe a release-owned manifest entry, never a path or command.
- Project trust is a server-authoritative persisted policy. A client may request a transition but cannot include policy, executable, initialization options, or arbitrary consent text in navigation traffic.
- Prewarm is advisory and must have a stable tab/language identity. Navigation demand bypasses the dwell; tab churn cancels it before any process admission.

## Requirements

- Test definition, implementation, references, modifier-click, F12/Ctrl-or-Cmd+F12/Shift+F12, and context actions through public APIs only.
- Define typed request/result/status/error/cancellation/capability shapes. No raw JSON-RPC, absolute path, executable, bundle path, or root URI.
- Define a server-owned trust DTO: `restricted`, `trusted`, `revoked`, transition availability/reason, and policy revision; requests carry only `{ project, desiredTrust, confirmation }` with server-generated confirmation challenge binding.
- Define descriptor availability without environment leakage: `ready`, `bundleUnavailable`, `bundleInvalid`, `unsupportedCapability`, `restricted`, or runtime state; include stable language/descriptor IDs only.
- Freeze `PREWARM_DWELL_MS = 750`: only a supported, hydrated, active tab that remains in the same project/language may request prewarm; no filesystem scan; explicit navigation bypasses dwell.
- Record one UI branch: native public APIs or shared virtualized-results fallback.

## Architecture

- `SemanticUri` uses profile ID, project ID, normalized relative path, and language only; server maps to internal URI after authorization.
- `SemanticTrustState` is returned by the authenticated semantic capability handshake and dedicated trust API, versioned independently of a transport connection. Revocation increases the policy revision and invalidates affected sessions.
- `BundleAvailability` is derived from a signed/verified release manifest selected by server OS/architecture. The protocol exposes no checksum, filesystem location, or fallback resolver.
- `PrewarmIntent` is a local controller event keyed by profile/workspace/project/language/tab generation. It becomes eligible once after 750 ms and is discarded on any key change.

## Related code files

- Create: `/mnt/data/ws/sharing/dam-hopper/packages/shared/src/semantic-protocol.ts` — browser-safe protocol, trust, availability, limits, and dwell constant.
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/shared/src/semantic-protocol.test.ts` — serialization and forbidden-field tests.
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/semantic-navigation.compat.browser.test.tsx` — public Monaco action/opener matrix and prewarm no-I/O harness.
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MonacoHost.tsx` — test seam only; no production provider commitment before Gate A/B.
- Create: `/mnt/data/ws/sharing/dam-hopper/server/src/semantic/protocol.rs` — matching bounded DTO design target.
- Create: `/mnt/data/ws/sharing/dam-hopper/server/src/semantic/bundle_manifest.rs` — manifest/domain design target.
- Create: `/mnt/data/ws/sharing/dam-hopper/server/src/semantic/trust.rs` — trust-domain design target.
- Delete: none.

## Implementation Steps

1. Define protocol types and validators for model identity, UTF-16 positions/ranges, navigation results, capability/status, trust state/transition, and bundle availability. Add compile-time/serialization tests that reject host/executable/URI leakage.
2. Define the one-time trust confirmation challenge and policy-revision semantics. Document restricted and trusted initialization-policy capability sets; do not persist user state in this phase.
3. Define bundle manifest fields: descriptor/runtime IDs, exact versions, OS/architecture selector, artifact checksums, license IDs, SBOM references, compressed/uncompressed size budgets, and invalid/missing behavior. Keep it server/release internal.
4. Build a Chromium harness with source, unopened target, and dirty target. Instrument model creation, file loads, and prewarm-intent calls.
5. Register public providers for Rust, TypeScript/JavaScript, and Java; invoke built-in actions and modifier-click. Verify cancellation tokens reach the provider.
6. Exercise one, many, null, stale, unsupported, restricted, bundle-unavailable, and capped results. Confirm 500 results create no target models and no tab state can schedule process work before the dwell.
7. Exercise timer cancellation: tab switch, edit reload, project/profile/workspace switch, unmount, and 749 ms churn cause zero prewarm calls; at 750 ms exactly one key-scoped intent occurs. Select Gate A or B and freeze tests.

## Todo list

- [x] Protocol and forbidden-field tests compile.
- [x] Trust transition and policy-revision contract is frozen.
- [x] Bundle-manifest and availability contract is frozen.
- [x] URI/range fuzz-style edge cases pass.
- [x] Chromium tests cover unopened/dirty targets and prewarm churn.
- [x] Gate A or B is selected with public-API evidence.

## Success Criteria

- One documented public-API UI path works with Monaco 0.55.1.
- Contract cannot express a host path, executable, root URI, arbitrary LSP method, or trust policy payload.
- A supported stable tab yields one intent at 750 ms; scans and churn yield none.
- Tests fail if private Monaco access, eager target models, or host-tool fallback is introduced.

## Risk Assessment

- Native peek may require an internal model resolver. Mitigation: Gate B shared results surface.
- Consent copy can over-promise isolation. Mitigation: enumerate exact restricted/trusted policy effects and retain the no-OS-sandbox caveat.
- Timer tests can flake. Mitigation: fake timers plus Chromium event-count assertions.

## Security Considerations

- Treat model URIs and client transition requests as untrusted display/input identities, never authorization.
- A confirmation challenge is bound to the authenticated project and expires; server validates policy revision before transition.
- Cap labels/target counts; do not expose bundle provenance, source excerpts, paths, or commands in the browser.

## Next steps

- Phase 2 implements the frozen manifest resolver, persisted trust state, and process policy fingerprints.
- Phase 4 implements the selected UI branch, consent UX, and timer ownership.

## Completion

Phase 01 is DONE as of 2026-08-11 14:01:37 +07:00 (Asia/Ho_Chi_Minh). The contract, trust, bundle-availability, Monaco public-API compatibility, and delayed-prewarm gate requirements are complete and handed off to Phases 2 and 4.
